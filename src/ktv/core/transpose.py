"""Cache paired key changes at the original tempo and on one shared timeline."""

import asyncio
import hashlib
import logging
import tempfile
from pathlib import Path

from ktv.core.audio import original_audio_path

log = logging.getLogger("uvicorn.error")
_jobs: dict[Path, asyncio.Task] = {}
_render_limit = asyncio.Semaphore(1)


async def transposed_audio(job_dir: Path, semitones: int) -> dict[str, Path]:
    if not isinstance(semitones, int) or not -6 <= semitones <= 6:
        raise ValueError("Key must be an integer from -6 to 6")
    instrumental = job_dir / "no_vocals.webm"
    original = original_audio_path(job_dir)
    if not instrumental.is_file() or original is None:
        raise FileNotFoundError("Both source tracks are required for transposition")
    if semitones == 0:
        return {"instrumental": instrumental, "original": original}

    # Reprocessing either source invalidates all cached keys without touching
    # files that an existing playback request may still be reading.
    identity = [(p.name, p.stat().st_size, p.stat().st_mtime_ns) for p in (instrumental, original)]
    digest = hashlib.sha256(repr(identity).encode()).hexdigest()[:16]
    output_dir = job_dir / "keys" / f"v1-{digest}-{semitones:+d}"
    paths = {track: output_dir / f"{track}.webm" for track in ("instrumental", "original")}
    if all(path.is_file() and path.stat().st_size for path in paths.values()):
        return paths

    task = _jobs.get(output_dir)
    if task is None:
        task = asyncio.create_task(_render(instrumental, original, semitones, paths))
        _jobs[output_dir] = task

        def finished(completed):
            _jobs.pop(output_dir, None)
            if not completed.cancelled():
                completed.exception()  # Retrieve errors even if every caller disconnected.

        task.add_done_callback(finished)
    # A client changing its selection must not cancel another client's render.
    await asyncio.shield(task)
    return paths


async def _render(instrumental: Path, original: Path, semitones: int, paths: dict[str, Path]) -> None:
    async with _render_limit:
        parent = paths["instrumental"].parent.parent
        parent.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="render-", dir=parent) as tmp:
            temporary = {track: Path(tmp) / f"{track}.webm" for track in paths}
            ratio = 2 ** (semitones / 12)
            # Treat both stereo tracks as four coupled channels so the shared
            # accompaniment stays aligned when the guide-vocal mix changes.
            filters = (
                "[0:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a];"
                "[1:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,apad[b];"
                f"[a][b]amerge=inputs=2,rubberband=tempo=1:pitch={ratio:.12f}:channels=together:phase=independent:window=long:pitchq=consistency,"
                "asplit=2[c][d];"
                "[c]pan=stereo|c0=c0|c1=c1[instrumental];"
                "[d]pan=stereo|c0=c2|c1=c3[original]"
            )
            command = ["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(instrumental), "-i", str(original), "-filter_complex", filters]
            for track, path in temporary.items():
                command.extend(["-map", f"[{track}]", "-c:a", "libopus", "-b:a", "256k", str(path)])
            try:
                process = await asyncio.create_subprocess_exec(
                    *command, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
                )
            except OSError as exc:
                log.error("Could not start key rendering: %s", exc)
                raise RuntimeError("Could not start key rendering") from exc
            try:
                _, stderr = await asyncio.wait_for(process.communicate(), timeout=300)
            except BaseException:
                if process.returncode is None:
                    process.kill()
                    await process.wait()
                raise
            if process.returncode or not all(p.is_file() and p.stat().st_size for p in temporary.values()):
                log.error("Key rendering failed: %s", stderr.decode(errors="replace")[-2000:])
                raise RuntimeError("Could not prepare the selected key")
            paths["instrumental"].parent.mkdir(exist_ok=True)
            for track, path in temporary.items():
                path.replace(paths[track])
