import asyncio
import re
import shutil
import sys
from pathlib import Path

from ktv.config import CACHE_DIR


async def separate_vocals(video_id: str, progress_cb=None) -> Path:
    """
    Run demucs htdemucs --two-stems=vocals on audio.wav.
    Returns path to {job_dir}/no_vocals.wav.
    """
    job_dir = CACHE_DIR / video_id
    audio_path = job_dir / "audio.wav"
    dest_path = job_dir / "no_vocals.wav"

    if not audio_path.exists():
        raise RuntimeError(f"audio.wav not found at {audio_path} — download may have failed")

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
    demucs_out = job_dir / "htdemucs" / "audio" / "no_vocals.wav"
    if not demucs_out.exists():
        raise RuntimeError(f"Expected demucs output not found: {demucs_out}")

    shutil.move(str(demucs_out), str(dest_path))
    return dest_path
