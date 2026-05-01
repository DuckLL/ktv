import asyncio
import re
import shutil
import sys
from pathlib import Path

from ktv.config import CACHE_DIR


async def separate_vocals(video_id: str, progress_cb=None) -> Path:
    """
    Run demucs htdemucs --two-stems=vocals on audio.mp3.
    Converts demucs WAV output to no_vocals.mp3, then cleans up WAVs.
    Returns path to {job_dir}/no_vocals.mp3.
    """
    job_dir = CACHE_DIR / video_id
    audio_path = job_dir / "audio.mp3"
    dest_path = job_dir / "no_vocals.mp3"

    if not audio_path.exists():
        raise RuntimeError(f"audio.mp3 not found at {audio_path} — download may have failed")

    if dest_path.exists():
        return dest_path

    if progress_cb:
        await progress_cb(30, "Starting vocal separation (htdemucs, CPU — this may take several minutes)…")

    cmd = [
        sys.executable, "-m", "demucs",
        "--two-stems=vocals",
        "--device", "cpu",
        "--out", str(job_dir),
        str(audio_path),
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
    # (stem name matches input filename without extension = "audio")
    demucs_out = job_dir / "htdemucs" / "audio" / "no_vocals.wav"
    if not demucs_out.exists():
        raise RuntimeError(f"Expected demucs output not found: {demucs_out}")

    if progress_cb:
        await progress_cb(87, "Converting to MP3…")

    # Convert WAV → MP3 with ffmpeg
    conv = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", str(demucs_out),
        "-codec:a", "libmp3lame", "-qscale:a", "2",
        str(dest_path),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await conv.wait()
    if conv.returncode != 0:
        raise RuntimeError("ffmpeg MP3 conversion failed")

    # Clean up WAV files and demucs working directory
    shutil.rmtree(job_dir / "htdemucs", ignore_errors=True)

    return dest_path
