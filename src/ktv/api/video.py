from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse

from ktv.config import CACHE_DIR

router = APIRouter()


@router.get("/video/{video_id}")
async def serve_video(video_id: str):
    path = CACHE_DIR / video_id / "video_only.mp4"
    if not path.exists():
        return JSONResponse({"error": "Video not found"}, status_code=404)
    return FileResponse(path, media_type="video/mp4")


@router.get("/audio/{video_id}/instrumental")
async def serve_instrumental(video_id: str):
    path = CACHE_DIR / video_id / "no_vocals.wav"
    if not path.exists():
        return JSONResponse({"error": "Instrumental not found"}, status_code=404)
    return FileResponse(path, media_type="audio/wav")


@router.get("/audio/{video_id}/original")
async def serve_original(video_id: str):
    path = CACHE_DIR / video_id / "audio.wav"
    if not path.exists():
        return JSONResponse({"error": "Original audio not found"}, status_code=404)
    return FileResponse(path, media_type="audio/wav")
