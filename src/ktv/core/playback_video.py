"""Keep the downloaded picture intact and enable native media volume controls."""

import asyncio
import hashlib
import json
import logging
import math
import tempfile
from pathlib import Path

log = logging.getLogger("uvicorn.error")
_jobs: dict[Path, asyncio.Task] = {}
_render_limit = asyncio.Semaphore(1)


async def _run(command: list[str], timeout: int = 60) -> bytes:
    process = await asyncio.create_subprocess_exec(
        *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except BaseException:
        if process.returncode is None:
            process.kill()
            await process.wait()
        raise
    if process.returncode:
        log.error("Native video preparation failed: %s", stderr.decode(errors="replace")[-2000:])
        raise RuntimeError("Could not prepare native video controls")
    return stdout


async def playback_video(source: Path) -> Path:
    metadata = source.stat()
    identity = (source.name, metadata.st_size, metadata.st_mtime_ns)
    digest = hashlib.sha256(repr(identity).encode()).hexdigest()[:16]
    base = source.parent / f"player-v1-{digest}"
    for suffix in (".webm", ".mp4"):
        cached = base.with_suffix(suffix)
        if cached.is_file() and cached.stat().st_size:
            return cached

    task = _jobs.get(base)
    if task is None:
        task = asyncio.create_task(_render(source, base))
        _jobs[base] = task

        def finished(completed):
            _jobs.pop(base, None)
            if not completed.cancelled():
                completed.exception()

        task.add_done_callback(finished)
    return await asyncio.shield(task)


async def _render(source: Path, base: Path) -> Path:
    async with _render_limit:
        probe = json.loads(await _run([
            "ffprobe", "-v", "error", "-show_entries",
            "stream=codec_name,codec_type:format=duration", "-of", "json", str(source),
        ], timeout=10))
        video = next((stream for stream in probe["streams"] if stream["codec_type"] == "video"), None)
        if video is None:
            raise ValueError("Video stream not found")
        duration = float(probe["format"]["duration"])
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("Invalid video duration")
        webm = video["codec_name"] in {"vp8", "vp9", "av1"}
        destination = base.with_suffix(".webm" if webm else ".mp4")
        # A video without an audio track gets a disabled native volume button.
        # This silent track enables it; the browser routes volume/mute to the
        # synchronized Web Audio tracks, so their timing and mixing stay intact.
        with tempfile.TemporaryDirectory(prefix="player-", dir=source.parent) as tmp:
            output = Path(tmp) / destination.name
            command = [
                "ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(source),
                "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=48000",
                "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
                "-c:a", "libopus" if webm else "aac", "-b:a", "6k" if webm else "32k",
                "-threads", "1", "-t", str(duration), "-shortest",
            ]
            if webm:
                # CELT encodes digital silence without SILK comfort noise.
                command.extend(["-application", "lowdelay"])
            else:
                command.extend(["-movflags", "+faststart"])
            await _run([*command, str(output)])
            if not output.is_file() or not output.stat().st_size:
                raise RuntimeError("Native video preparation produced no media")
            output.replace(destination)
        return destination
