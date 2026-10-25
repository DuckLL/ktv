import asyncio
import re

import yt_dlp
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter()
_search_slot = asyncio.Semaphore(2)


def search_songs(query: str) -> list[dict]:
    with yt_dlp.YoutubeDL({
        "quiet": True, "no_warnings": True, "extract_flat": "in_playlist",
        "skip_download": True, "socket_timeout": 10, "retries": 1,
    }) as ydl:
        result = ydl.extract_info(f"ytsearch8:{query}", download=False)
    songs = []
    for item in (result or {}).get("entries", []):
        if not isinstance(item, dict):
            continue
        video_id = item.get("id", "")
        duration = item.get("duration")
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id) or item.get("live_status") == "is_live":
            continue
        if duration is not None and (duration <= 0 or duration > 600):
            continue
        songs.append({"video_id": video_id, "title": item.get("title") or video_id,
                      "artist": item.get("channel") or item.get("uploader") or "", "duration": duration})
    return songs


@router.get("/songs/search")
async def songs_search(q: str = Query(min_length=1, max_length=120)):
    query = q.strip()
    if not query:
        return JSONResponse({"error": "請輸入歌名或歌手"}, status_code=400)
    try:
        async with _search_slot:
            return await asyncio.wait_for(asyncio.to_thread(search_songs, query), timeout=30)
    except (TimeoutError, yt_dlp.utils.DownloadError):
        return JSONResponse({"error": "歌曲搜尋暫時無法使用，仍可貼上 YouTube 網址"}, status_code=502)
