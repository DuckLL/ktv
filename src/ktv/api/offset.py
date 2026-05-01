from fastapi import APIRouter
from pydantic import BaseModel
from ktv.core.db import get_offset, set_offset

router = APIRouter()


class OffsetBody(BaseModel):
    offset: float


@router.get("/offset/{video_id}/{lrclib_id}")
async def get_offset_api(video_id: str, lrclib_id: str):
    return {"offset": await get_offset(video_id, lrclib_id)}


@router.post("/offset/{video_id}/{lrclib_id}")
async def set_offset_api(video_id: str, lrclib_id: str, body: OffsetBody):
    await set_offset(video_id, lrclib_id, body.offset)
    return {"offset": body.offset}
