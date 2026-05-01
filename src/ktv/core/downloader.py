import asyncio
import json
import re
from pathlib import Path
from typing import AsyncIterator

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
    # Try to split "Artist - Title" from title if no separate artist
    if not info.get("artist") and " - " in title:
        parts = title.split(" - ", 1)
        artist, title = parts[0].strip(), parts[1].strip()
    return artist, title


async def download_video(url: str, progress_cb=None) -> tuple[str, dict]:
    """
    Download video+audio into cache dir.
    Returns (video_id, metadata_dict).
    progress_cb: async callable(pct: int, msg: str)
    """
    video_id = _extract_video_id(url)
    job_dir = CACHE_DIR / video_id
    job_dir.mkdir(exist_ok=True)

    video_path = job_dir / "video_only.mp4"
    audio_path = job_dir / "audio.mp3"
    meta_path = job_dir / "meta.json"

    # Return cached metadata if already downloaded
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

    info_pre = await loop.run_in_executor(None, _check_duration)

    if progress_cb:
        await progress_cb(10, "Downloading video & audio…")

    def _run_ytdlp():
        # Download video-only stream, cap at 720p to save space
        ydl_video_opts = {
            "format": "bestvideo[height<=720][ext=mp4]/bestvideo[height<=720]/bestvideo[ext=mp4]/bestvideo",
            "outtmpl": str(video_path),
            "quiet": True,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_video_opts) as ydl:
            info = ydl.extract_info(url, download=True)

        # Download audio and convert to mp3
        ydl_audio_opts = {
            "format": "bestaudio",
            "outtmpl": str(job_dir / "audio_raw.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
        }
        with yt_dlp.YoutubeDL(ydl_audio_opts) as ydl:
            ydl.extract_info(url, download=True)

        candidates = list(job_dir.glob("audio_raw*.mp3"))
        if not candidates:
            candidates = [p for p in job_dir.glob("*.mp3") if p.name != "audio.mp3"]
        if not candidates:
            raise RuntimeError("audio conversion to mp3 failed — is ffmpeg installed?")
        candidates[0].rename(audio_path)

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
