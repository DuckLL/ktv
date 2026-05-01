from fastapi import APIRouter, Response
from pydantic import BaseModel
from ktv.core.db import get_selection, set_selection

router = APIRouter()


class SelectionBody(BaseModel):
    lrclib_id: str
    track_name: str = ""
    artist_name: str = ""
    synced_lyrics: str | None = None


@router.get("/selection/{video_id}")
async def get_selection_api(video_id: str):
    row = await get_selection(video_id)
    if not row:
        return Response(status_code=204)
    return row


@router.post("/selection/{video_id}")
async def set_selection_api(video_id: str, body: SelectionBody):
    await set_selection(
        video_id, body.lrclib_id,
        body.track_name, body.artist_name, body.synced_lyrics,
    )
    return {"ok": True}
