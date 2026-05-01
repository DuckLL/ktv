import asyncio
import json
import re
from pathlib import Path

import yt_dlp

from ktv.config import CACHE_DIR


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
        with yt_dlp.YoutubeDL(ydl_video_opts) as ydl:
            info = ydl.extract_info(url, download=True)

        # Opus/WebM audio — zero transcoding
        ydl_audio_opts = {
            "format": "bestaudio[ext=webm]/bestaudio[acodec=opus]",
            "outtmpl": str(audio_path),
            "quiet": True,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_audio_opts) as ydl:
            ydl.extract_info(url, download=True)

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
