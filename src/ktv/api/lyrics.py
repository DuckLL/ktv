from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from ktv.core.lyrics_client import search_lyrics, get_lyrics, find_lyrics

router = APIRouter()


@router.get("/lyrics/search")
async def lyrics_search(
    q: str = Query(default=""),
    artist: str = Query(default=""),
    track: str = Query(default=""),
):
    try:
        results = await search_lyrics(q=q, artist=artist, track=track)
        return results
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)


@router.get("/lyrics/auto")
async def lyrics_auto(
    title: str = Query(min_length=1, max_length=300),
    artist: str = Query(default="", max_length=200),
    duration: float = Query(default=0, ge=0, le=1200),
):
    try:
        return await find_lyrics(title, artist, duration)
    except Exception:
        return JSONResponse({"error": "自動找歌詞暫時無法使用，可手動搜尋"}, status_code=502)


@router.get("/lyrics/{lrclib_id}")
async def lyrics_get(lrclib_id: int):
    try:
        data = await get_lyrics(lrclib_id)
        return data
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)
