import asyncio
import codecs
import json
import re
import shutil
import sys
from collections import deque
from pathlib import Path

from ktv.config import CACHE_DIR
from ktv.core.audio import original_audio_path

SEPARATION_PROFILE = {"backend": "demucs", "model": "htdemucs", "pipeline_version": 2}


def separated_audio_paths(video_id: str) -> dict[str, Path | None]:
    job_dir = CACHE_DIR / video_id
    return {
        "instrumental": job_dir / "no_vocals.webm",
        "original": original_audio_path(job_dir),
    }


def separated_audio_ready(video_id: str) -> bool:
    paths = separated_audio_paths(video_id)
    if not all(path and path.is_file() and path.stat().st_size for path in paths.values()):
        return False
    try:
        profile = json.loads((CACHE_DIR / video_id / "separation.json").read_text())
        return profile == SEPARATION_PROFILE
    except (OSError, ValueError):
        return False


async def relay_progress(stream: asyncio.StreamReader, progress_cb, tail: deque) -> None:
    """Report demucs' tqdm percentages as they happen; tqdm redraws with \\r, not \\n."""
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    last_pct = None

    async def handle(line: str) -> None:
        nonlocal last_pct
        text = line.strip()
        if not text:
            return
        tail.append(text)
        m = re.search(r"(\d+)%", text)
        if m and progress_cb and m.group(1) != last_pct:
            last_pct = m.group(1)
            raw = int(last_pct)
            await progress_cb(30 + int(raw * 0.55), f"Separating vocals… {raw}%")

    pending = ""
    while chunk := await stream.read(4096):
        *lines, pending = re.split(r"[\r\n]", pending + decoder.decode(chunk))
        for line in lines:
            await handle(line)
    await handle(pending + decoder.decode(b"", final=True))


def cleanup_separation_sources(video_id: str) -> None:
    job_dir = CACHE_DIR / video_id
    (job_dir / "audio.wav").unlink(missing_ok=True)
    (job_dir / "vocals.webm").unlink(missing_ok=True)


async def separate_vocals(video_id: str, progress_cb=None) -> Path:
    """
    Run demucs htdemucs --two-stems=vocals.
    Preserve source audio and produce accompaniment at the source's gain.
    """
    job_dir = CACHE_DIR / video_id
    audio_path = original_audio_path(job_dir)
    audio_paths = separated_audio_paths(video_id)
    instrumental_dest_path = audio_paths["instrumental"]
    wav_path = job_dir / "audio.wav"   # temp for demucs

    if audio_path is None:
        raise RuntimeError("Original audio not found — download may have failed")

    if separated_audio_ready(video_id):
        return instrumental_dest_path

    if progress_cb:
        await progress_cb(30, "Starting vocal separation (htdemucs, CPU — this may take several minutes)…")

    # Float PCM avoids an extra integer quantization step. Keep the original
    # amplitude so replacing accompaniment with the original does not boost vocals.
    decode = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", str(audio_path),
        "-ac", "2", "-ar", "44100", "-c:a", "pcm_f32le", str(wav_path),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await decode.wait()
    if decode.returncode != 0:
        raise RuntimeError("ffmpeg failed to decode source audio to wav")

    # Demucs 4.0.1's CLI always rescales or clamps. The worker uses the same
    # model and inference settings but writes float PCM at the source gain.
    cmd = [
        sys.executable, "-m", "ktv.core.demucs_worker",
        str(wav_path),
        str(job_dir / "htdemucs" / "audio" / "no_vocals.wav"),
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    stderr_lines = deque(maxlen=20)
    await asyncio.gather(relay_progress(proc.stderr, progress_cb, stderr_lines), proc.wait())

    if proc.returncode != 0:
        tail = "\n".join(list(stderr_lines)[-10:])
        raise RuntimeError(f"demucs exited with code {proc.returncode}:\n{tail}")

    # demucs outputs to {job_dir}/htdemucs/audio/{no_vocals,vocals}.wav
    demucs_no_vocals = job_dir / "htdemucs" / "audio" / "no_vocals.wav"
    if not demucs_no_vocals.exists():
        raise RuntimeError(f"Expected demucs output not found: {demucs_no_vocals}")

    if progress_cb:
        await progress_cb(87, "Saving accompaniment; preserving original audio…")

    # Step 3: get exact source duration to trim demucs padding
    probe = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(audio_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await probe.communicate()
    src_duration = stdout.decode().strip()

    # Protect peaks without independently normalizing each stem. Compensate
    # limiter latency to preserve alignment with the untouched original.
    temporary_output = job_dir / "no_vocals.tmp.webm"
    conv = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", str(demucs_no_vocals),
        *(["-t", src_duration] if src_duration else []),
        "-af", "alimiter=limit=0.98:level=false:latency=true",
        "-codec:a", "libopus", "-b:a", "256k", str(temporary_output),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await conv.wait()
    if conv.returncode != 0:
        raise RuntimeError("ffmpeg accompaniment conversion failed")
    temporary_output.replace(instrumental_dest_path)
    temporary_profile = job_dir / "separation.json.tmp"
    temporary_profile.write_text(json.dumps(SEPARATION_PROFILE))
    temporary_profile.replace(job_dir / "separation.json")

    # Keep the untouched original; discard only intermediate and old vocal files.
    cleanup_separation_sources(video_id)
    shutil.rmtree(job_dir / "htdemucs", ignore_errors=True)

    return instrumental_dest_path
