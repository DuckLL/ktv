import asyncio
import json

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ktv.config import CACHE_DIR
from ktv.core.downloader import download_video, _extract_video_id
from ktv.core.separator import separate_vocals, separated_audio_ready
from ktv.core.db import upsert_pending_video, upsert_video, get_all_videos

router = APIRouter()

_jobs: dict[str, dict] = {}


class ProcessRequest(BaseModel):
    url: str


@router.post("/process")
async def process(req: ProcessRequest):
    url = req.url
    try:
        video_id = _extract_video_id(url)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    if separated_audio_ready(video_id):
        meta = await _get_video_meta(video_id)
        if meta:
            return {"status": "done", "pct": 100, **meta}

    job = _jobs.get(video_id)
    if job and job.get("status") in {"queued", "processing"}:
        return JSONResponse({"status": job["status"], "video_id": video_id}, status_code=202)

    await upsert_pending_video(video_id)
    _jobs[video_id] = {
        "status": "queued",
        "pct": 0,
        "msg": "已加入背景處理",
        "video_id": video_id,
    }
    asyncio.create_task(_run_background_process(url, video_id))
    return JSONResponse({"status": "queued", "video_id": video_id}, status_code=202)


@router.get("/status/{video_id}")
async def status(video_id: str):
    if separated_audio_ready(video_id):
        meta = await _get_video_meta(video_id)
        if meta:
            return {"status": "done", **meta}
    job = _jobs.get(video_id)
    if job:
        return job
    meta = await _get_video_meta(video_id)
    if meta and meta.get("processed_at") == 0:
        return {"status": "queued", **meta}
    return JSONResponse({"error": "not found"}, status_code=404)


async def _run_background_process(url: str, video_id: str):
    async def progress(pct: int, msg: str):
        _jobs[video_id].update({
            "status": "processing",
            "pct": pct,
            "msg": msg,
            "stage": _stage_for(pct),
            "video_id": video_id,
        })

    try:
        await progress(0, "開始背景處理…")
        video_id_out, meta = await download_video(url, progress)
        await upsert_pending_video(video_id_out, meta)

        no_vocals = await separate_vocals(video_id_out, progress)
        await progress(98, "Done!")

        processed_at = int(no_vocals.stat().st_mtime)
        await upsert_video(meta, processed_at)
        _jobs[video_id] = {
            "status": "done",
            "pct": 100,
            "msg": "完成",
            **meta,
        }
    except Exception as exc:
        _jobs[video_id] = {
            "status": "error",
            "pct": 0,
            "msg": str(exc),
            "video_id": video_id,
        }


async def _get_video_meta(video_id: str) -> dict | None:
    rows = await get_all_videos()
    meta = next((r for r in rows if r["video_id"] == video_id), None)
    if meta is not None:
        return meta

    meta_path = CACHE_DIR / video_id / "meta.json"
    if meta_path.exists():
        return json.loads(meta_path.read_text())
    return None


def _stage_for(pct: int) -> str:
    if pct < 29:
        return "downloading"
    if pct < 88:
        return "separating"
    return "finishing"
