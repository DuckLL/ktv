from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from ktv.core.lyrics_client import search_lyrics, get_lyrics

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


@router.get("/lyrics/{lrclib_id}")
async def lyrics_get(lrclib_id: int):
    try:
        data = await get_lyrics(lrclib_id)
        return data
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)
