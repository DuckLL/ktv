from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse, JSONResponse

from ktv.config import CACHE_DIR
from ktv.core.cache import touch
from ktv.core.audio import AUDIO_MEDIA_TYPES, original_audio_path
from ktv.core.transpose import transposed_audio

router = APIRouter()


@router.get("/video/{video_id}")
async def serve_video(video_id: str):
    path = CACHE_DIR / video_id / "video_only.webm"
    if not path.exists():
        return JSONResponse({"error": "Video not found"}, status_code=404)
    await touch(video_id)
    return FileResponse(path, media_type="video/webm")


@router.get("/audio/{video_id}/instrumental")
async def serve_instrumental(video_id: str, key: Annotated[int, Query(ge=-6, le=6)] = 0):
    path = CACHE_DIR / video_id / "no_vocals.webm"
    if not path.exists():
        return JSONResponse({"error": "Instrumental not found"}, status_code=404)
    await touch(video_id)
    if key:
        return await serve_key(video_id, "instrumental", key)
    return FileResponse(path, media_type="audio/webm")


@router.get("/audio/{video_id}/original")
async def serve_original(video_id: str, key: Annotated[int, Query(ge=-6, le=6)] = 0):
    path = original_audio_path(CACHE_DIR / video_id)
    if path is None:
        return JSONResponse({"error": "Original audio not found; reprocess this song"}, status_code=404)
    await touch(video_id)
    if key:
        return await serve_key(video_id, "original", key)
    return FileResponse(path, media_type=AUDIO_MEDIA_TYPES[path.suffix])


async def serve_key(video_id: str, track: str, key: int):
    try:
        paths = await transposed_audio(CACHE_DIR / video_id, key)
        return FileResponse(paths[track], media_type="audio/webm")
    except FileNotFoundError:
        return JSONResponse({"error": "Source tracks not found; reprocess this song"}, status_code=404)
    except (RuntimeError, TimeoutError):
        return JSONResponse({"error": "Could not prepare the selected key; please try again"}, status_code=503)


@router.get("/pitch/{video_id}")
async def serve_pitch(video_id: str):
    path = CACHE_DIR / video_id / "pitch.json"
    if not path.exists():
        return JSONResponse({"error": "Pitch data not found; reprocess this song"}, status_code=404)
    await touch(video_id)
    return FileResponse(path, media_type="application/json")
