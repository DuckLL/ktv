from fastapi import APIRouter
from ktv.core.db import get_all_videos

router = APIRouter()


@router.get("/library")
async def list_library():
    return await get_all_videos()
