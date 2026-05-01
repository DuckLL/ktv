import asyncio
import re
import shutil
import sys
from pathlib import Path

from ktv.config import CACHE_DIR


async def separate_vocals(video_id: str, progress_cb=None) -> Path:
    """
    Run demucs htdemucs --two-stems=vocals.
    Input:  audio.webm (Opus)
    Output: no_vocals.webm (Opus, trimmed to source duration)
    """
    job_dir = CACHE_DIR / video_id
    audio_path = job_dir / "audio.webm"
    dest_path = job_dir / "no_vocals.webm"
    wav_path = job_dir / "audio.wav"   # temp for demucs

    if not audio_path.exists():
        raise RuntimeError(f"audio.webm not found at {audio_path} — download may have failed")

    if dest_path.exists():
        return dest_path

    if progress_cb:
        await progress_cb(30, "Starting vocal separation (htdemucs, CPU — this may take several minutes)…")

    # Step 1: decode webm → wav for demucs
    decode = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", str(audio_path), str(wav_path),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await decode.wait()
    if decode.returncode != 0:
        raise RuntimeError("ffmpeg failed to decode audio.webm to wav")

    # Step 2: run demucs
    cmd = [
        sys.executable, "-m", "demucs",
        "--two-stems=vocals",
        "--device", "cpu",
        "--out", str(job_dir),
        str(wav_path),
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    stderr_lines: list[str] = []

    async def _read_stderr():
        async for line in proc.stderr:
            text = line.decode(errors="replace").strip()
            if text:
                stderr_lines.append(text)
            m = re.search(r"(\d+)%", text)
            if m and progress_cb:
                raw = int(m.group(1))
                pct = 30 + int(raw * 0.55)
                await progress_cb(pct, f"Separating vocals… {raw}%")

    await asyncio.gather(_read_stderr(), proc.wait())

    if proc.returncode != 0:
        tail = "\n".join(stderr_lines[-10:])
        raise RuntimeError(f"demucs exited with code {proc.returncode}:\n{tail}")

    # demucs outputs to {job_dir}/htdemucs/audio/no_vocals.wav
    demucs_out = job_dir / "htdemucs" / "audio" / "no_vocals.wav"
    if not demucs_out.exists():
        raise RuntimeError(f"Expected demucs output not found: {demucs_out}")

    if progress_cb:
        await progress_cb(87, "Converting to Opus/WebM…")

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

    # Step 4: WAV → Opus/WebM, trimmed to source duration
    conv = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", str(demucs_out),
        *([ "-t", src_duration ] if src_duration else []),
        "-codec:a", "libopus", "-b:a", "160k",
        str(dest_path),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await conv.wait()
    if conv.returncode != 0:
        raise RuntimeError("ffmpeg Opus/WebM conversion failed")

    # Cleanup temp files
    wav_path.unlink(missing_ok=True)
    shutil.rmtree(job_dir / "htdemucs", ignore_errors=True)

    return dest_path
