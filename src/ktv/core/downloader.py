import asyncio
import json
import logging
import re
import time
from pathlib import Path

import yt_dlp
from yt_dlp.utils import DownloadError

from ktv.config import CACHE_DIR

log = logging.getLogger("uvicorn.error")

# YouTube sporadically answers a stream URL with 403 (formats behind its PO
# token checks); in testing about one download in six, and a fresh extraction
# right after gets a new URL that works. Retry only that case.
DOWNLOAD_ATTEMPTS = 3
RETRY_DELAY = 3  # seconds, multiplied by the attempt number


def _download_with_retry(opts: dict, url: str, *, sleep=time.sleep) -> dict:
    out = Path(opts["outtmpl"])
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=True)
        except DownloadError as exc:
            if "HTTP Error 403" not in str(exc) or attempt == DOWNLOAD_ATTEMPTS:
                raise
            log.warning("download: HTTP 403 for %s (attempt %d/%d), retrying with a fresh extraction",
                        out.name, attempt, DOWNLOAD_ATTEMPTS)
            # A partial file from the rejected URL must not be resumed against a new one.
            for leftover in (out, out.with_name(out.name + ".part")):
                leftover.unlink(missing_ok=True)
            sleep(RETRY_DELAY * attempt)
    raise AssertionError("unreachable")


def _extract_video_id(url: str) -> str:
    patterns = [
        r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})",
        r"(?:embed/)([A-Za-z0-9_-]{11})",
    ]
    for pat in patterns:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    raise ValueError(f"Cannot extract video ID from URL: {url}")


def _parse_artist_title(info: dict) -> tuple[str, str]:
    artist = info.get("artist") or info.get("uploader") or ""
    title = info.get("track") or info.get("title") or ""
    if not info.get("artist") and " - " in title:
        parts = title.split(" - ", 1)
        artist, title = parts[0].strip(), parts[1].strip()
    return artist, title


async def download_video(url: str, progress_cb=None) -> tuple[str, dict]:
    """
    Download VP9/WebM video + Opus/WebM audio directly from YouTube (no transcoding).
    Returns (video_id, metadata_dict).
    """
    video_id = _extract_video_id(url)
    job_dir = CACHE_DIR / video_id
    job_dir.mkdir(exist_ok=True)

    video_path = job_dir / "video_only.webm"
    audio_path = job_dir / "audio.webm"
    meta_path = job_dir / "meta.json"

    if meta_path.exists() and video_path.exists() and audio_path.exists():
        with open(meta_path) as f:
            return video_id, json.load(f)

    if progress_cb:
        await progress_cb(5, "Fetching video info…")

    loop = asyncio.get_event_loop()

    def _check_duration():
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
            info = ydl.extract_info(url, download=False)
        duration = info.get("duration") or 0
        if duration > 600:
            mins = duration // 60
            raise ValueError(f"影片長度 {mins} 分鐘，超過 10 分鐘上限")
        return info

    await loop.run_in_executor(None, _check_duration)

    if progress_cb:
        await progress_cb(10, "Downloading video & audio…")

    def _run_ytdlp():
        # VP9/WebM video, no transcoding
        ydl_video_opts = {
            "format": (
                "bestvideo[vcodec^=vp9][ext=webm][height<=720]"
                "/bestvideo[ext=webm][height<=720]"
                "/bestvideo[height<=720]"
            ),
            "outtmpl": str(video_path),
            "quiet": True,
            "no_warnings": True,
        }
        info = _download_with_retry(ydl_video_opts, url)

        # Opus/WebM audio — zero transcoding
        ydl_audio_opts = {
            "format": "bestaudio[ext=webm]/bestaudio[acodec=opus]",
            "outtmpl": str(audio_path),
            "quiet": True,
            "no_warnings": True,
        }
        _download_with_retry(ydl_audio_opts, url)

        artist, title = _parse_artist_title(info)
        meta = {
            "video_id": video_id,
            "title": title,
            "artist": artist,
            "duration": info.get("duration", 0),
            "thumbnail": info.get("thumbnail", ""),
        }
        with open(meta_path, "w") as f:
            json.dump(meta, f)
        return meta

    meta = await loop.run_in_executor(None, _run_ytdlp)

    if progress_cb:
        await progress_cb(28, "Download complete")

    return video_id, meta
