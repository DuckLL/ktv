from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse

from ktv.config import CACHE_DIR
from ktv.core.cache import touch
from ktv.core.audio import AUDIO_MEDIA_TYPES, original_audio_path

router = APIRouter()


@router.get("/video/{video_id}")
async def serve_video(video_id: str):
    path = CACHE_DIR / video_id / "video_only.webm"
    if not path.exists():
        return JSONResponse({"error": "Video not found"}, status_code=404)
    await touch(video_id)
    return FileResponse(path, media_type="video/webm")


@router.get("/audio/{video_id}/instrumental")
async def serve_instrumental(video_id: str):
    path = CACHE_DIR / video_id / "no_vocals.webm"
    if not path.exists():
        return JSONResponse({"error": "Instrumental not found"}, status_code=404)
    await touch(video_id)
    return FileResponse(path, media_type="audio/webm")


@router.get("/audio/{video_id}/original")
async def serve_original(video_id: str):
    path = original_audio_path(CACHE_DIR / video_id)
    if path is None:
        return JSONResponse({"error": "Original audio not found; reprocess this song"}, status_code=404)
    await touch(video_id)
    return FileResponse(path, media_type=AUDIO_MEDIA_TYPES[path.suffix])
