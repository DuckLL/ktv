import asyncio
import json

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from ktv.config import CACHE_DIR
from ktv.core.downloader import download_video, _extract_video_id
from ktv.core.separator import separate_vocals
from ktv.core.db import upsert_video, get_all_videos

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

    no_vocals_path = CACHE_DIR / video_id / "no_vocals.wav"

    if no_vocals_path.exists():
        rows = await get_all_videos()
        meta = next((r for r in rows if r["video_id"] == video_id), None)
        if meta is None:
            meta_path = CACHE_DIR / video_id / "meta.json"
            if meta_path.exists():
                meta = json.loads(meta_path.read_text())
        if meta:
            async def _cached_stream():
                yield {"data": json.dumps({"stage": "done", "pct": 100, **meta})}
            return EventSourceResponse(_cached_stream())

    async def _stream():
        _jobs[video_id] = {"status": "processing", "pct": 0, "msg": "Starting…"}

        q: asyncio.Queue = asyncio.Queue()

        async def progress(pct: int, msg: str):
            _jobs[video_id].update({"pct": pct, "msg": msg})
            await q.put({"pct": pct, "msg": msg, "stage": _stage_for(pct)})

        async def _run():
            try:
                video_id_out, meta = await download_video(url, progress)
                no_vocals = await separate_vocals(video_id_out, progress)
                await progress(98, "Done!")
                processed_at = int(no_vocals.stat().st_mtime)
                await upsert_video(meta, processed_at)
                _jobs[video_id]["status"] = "done"
                await q.put({"stage": "done", "pct": 100, **meta})
            except Exception as exc:
                _jobs[video_id]["status"] = "error"
                await q.put({"stage": "error", "msg": str(exc)})
            finally:
                await q.put(None)

        asyncio.create_task(_run())

        while True:
            item = await q.get()
            if item is None:
                break
            yield {"data": json.dumps(item)}

    return EventSourceResponse(_stream())


@router.get("/status/{video_id}")
async def status(video_id: str):
    no_vocals_path = CACHE_DIR / video_id / "no_vocals.wav"
    if no_vocals_path.exists():
        rows = await get_all_videos()
        meta = next((r for r in rows if r["video_id"] == video_id), None)
        if meta:
            return {"status": "done", **meta}
    job = _jobs.get(video_id)
    if job:
        return job
    return JSONResponse({"error": "not found"}, status_code=404)


def _stage_for(pct: int) -> str:
    if pct < 29:
        return "downloading"
    if pct < 88:
        return "separating"
    return "finishing"
