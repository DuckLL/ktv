import asyncio
import copy
import json
import logging
import re
import time
from pathlib import Path

import yt_dlp
from yt_dlp.utils import DownloadError

from ktv.config import CACHE_DIR
from ktv.core.audio import AUDIO_MEDIA_TYPES, original_audio_path

log = logging.getLogger("uvicorn.error")

# YouTube sporadically answers a stream URL with 403 (formats behind its PO
# token checks); in testing about one download in six, sometimes twice in a
# row, and a fresh extraction right after gets a new URL that works. Retry only
# that case; five attempts wait at most 3+6+9+12 = 30 s.
DOWNLOAD_ATTEMPTS = 5
RETRY_DELAY = 3  # seconds, multiplied by the attempt number


def _download_with_retry(opts: dict, url: str, info: dict | None = None, *, sleep=time.sleep) -> dict:
    out = Path(opts["outtmpl"])
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                if info is not None:
                    # yt-dlp adds the selected format to the dict it processes.
                    return ydl.process_ie_result(copy.deepcopy(info), download=True)
                return ydl.extract_info(url, download=True)
        except DownloadError as exc:
            if "HTTP Error 403" not in str(exc) or attempt == DOWNLOAD_ATTEMPTS:
                raise
            log.warning("download: HTTP 403 for %s (attempt %d/%d), retrying with a fresh extraction",
                        out.name, attempt, DOWNLOAD_ATTEMPTS)
            # A partial file from the rejected URL must not be resumed against a new one.
            for pattern in (out.name, out.name + ".part", out.name + ".ytdl"):
                for leftover in out.parent.glob(pattern.replace("%(ext)s", "*")):
                    if leftover.is_file():
                        leftover.unlink(missing_ok=True)
            info = None
            sleep(RETRY_DELAY * attempt)
    raise AssertionError("unreachable")


def _extract_video_id(url: str) -> str:
    m = re.search(r"(?:[?&]v=|youtu\.be/|/(?:embed|shorts|live)/)([A-Za-z0-9_-]{11})", url)
    if m:
        return m.group(1)
    raise ValueError(f"Cannot extract video ID from URL: {url}")


def _extract_info(url: str) -> dict:
    """Extract once (YouTube's JS challenge included) for the duration check and both downloads."""
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
        info = ydl.extract_info(url, download=False)
    # Drop the default format selection so each download picks its own stream,
    # as yt-dlp does for --load-info-json.
    return yt_dlp.YoutubeDL.sanitize_info(info, remove_private_keys=True)


def _parse_artist_title(info: dict) -> tuple[str, str]:
    artist = info.get("artist") or info.get("uploader") or ""
    title = info.get("track") or info.get("title") or ""
    if not info.get("artist") and " - " in title:
        parts = title.split(" - ", 1)
        artist, title = parts[0].strip(), parts[1].strip()
    return artist, title


async def download_video(url: str, progress_cb=None) -> tuple[str, dict]:
    """
    Download video and the best available audio in its native container, without transcoding.
    Returns (video_id, metadata_dict).
    """
    video_id = _extract_video_id(url)
    # A URL copied from a mix or playlist (&list=...) would make yt-dlp
    # process the whole playlist.
    url = f"https://www.youtube.com/watch?v={video_id}"
    job_dir = CACHE_DIR / video_id
    job_dir.mkdir(exist_ok=True)

    video_path = job_dir / "video_only.webm"
    meta_path = job_dir / "meta.json"

    if meta_path.exists() and video_path.exists() and original_audio_path(job_dir):
        with open(meta_path) as f:
            meta = json.load(f)
        if meta.get("source_audio"):
            return video_id, meta

    if progress_cb:
        await progress_cb(5, "Fetching video info…")

    loop = asyncio.get_event_loop()

    source_info = await loop.run_in_executor(None, _extract_info, url)
    duration = source_info.get("duration") or 0
    if duration > 600:
        mins = duration // 60
        raise ValueError(f"影片長度 {mins} 分鐘，超過 10 分鐘上限")

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
            "noprogress": True,
            "no_warnings": True,
        }
        info = _download_with_retry(ydl_video_opts, url, source_info)

        # Do not exclude high-quality AAC or accept lower WebM quality just to
        # keep a particular container. yt-dlp keeps language/quality preferences
        # and then chooses the highest available bitrate and sample rate.
        ydl_audio_opts = {
            "format": "bestaudio",
            "format_sort": ["quality", "abr", "asr", "acodec"],
            "outtmpl": str(job_dir / "original.%(ext)s"),
            "quiet": True,
            "noprogress": True,
            "no_warnings": False,
        }
        audio_info = _download_with_retry(ydl_audio_opts, url, source_info)
        extension = "." + audio_info["ext"]
        if extension not in AUDIO_MEDIA_TYPES:
            raise RuntimeError(f"Unsupported source audio container: {extension}")
        audio_path = job_dir / f"original{extension}"
        if not audio_path.is_file() or not audio_path.stat().st_size:
            raise RuntimeError("yt-dlp did not produce the selected audio file")
        source_audio = {
            "file": audio_path.name,
            "format_id": audio_info.get("format_id"),
            "codec": audio_info.get("acodec"),
            "bitrate_kbps": audio_info.get("abr"),
            "sample_rate": audio_info.get("asr"),
            "channels": audio_info.get("audio_channels"),
            "yt_dlp_version": yt_dlp.version.__version__,
        }
        log.info("audio source for %s: %s", video_id, source_audio)

        artist, title = _parse_artist_title(info)
        meta = {
            "video_id": video_id,
            "title": title,
            "artist": artist,
            "duration": info.get("duration", 0),
            "thumbnail": info.get("thumbnail", ""),
            "source_audio": source_audio,
        }
        temporary_meta = meta_path.with_suffix(".json.tmp")
        temporary_meta.write_text(json.dumps(meta))
        temporary_meta.replace(meta_path)
        return meta

    meta = await loop.run_in_executor(None, _run_ytdlp)

    if progress_cb:
        await progress_cb(28, "Download complete")

    return video_id, meta
