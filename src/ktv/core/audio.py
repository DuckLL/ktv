"""Locate untouched source audio, including caches from the WebM-only player."""

import json
from pathlib import Path

AUDIO_MEDIA_TYPES = {
    ".webm": "audio/webm", ".m4a": "audio/mp4", ".mp4": "audio/mp4",
    ".opus": "audio/ogg", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
    ".flac": "audio/flac", ".wav": "audio/wav", ".aac": "audio/aac",
}


def original_audio_path(job_dir: Path) -> Path | None:
    meta_path = job_dir / "meta.json"
    if meta_path.exists():
        try:
            filename = json.loads(meta_path.read_text()).get("source_audio", {}).get("file", "")
            if filename and Path(filename).name == filename and filename.startswith("original."):
                path = job_dir / filename
                if path.suffix in AUDIO_MEDIA_TYPES and path.is_file() and path.stat().st_size:
                    return path
        except (ValueError, TypeError, AttributeError, OSError):
            pass
    for path in sorted(job_dir.glob("original.*")):
        if path.suffix in AUDIO_MEDIA_TYPES and path.is_file() and path.stat().st_size:
            return path
    legacy = job_dir / "audio.webm"
    return legacy if legacy.is_file() and legacy.stat().st_size else None
