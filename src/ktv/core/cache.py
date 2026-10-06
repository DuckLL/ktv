"""Evict songs nobody has played for a while.

The media in cache/{video_id}/ (video, separated stems) is large and can always
be rebuilt by processing the URL again, so a song not accessed for
KTV_CACHE_TTL_DAYS (default 7, 0 disables) loses its cache directory and its
library row. Lyric selections and offsets stay in the database, so processing
it again brings the user's choices back.
"""

import asyncio
import logging
import os
import shutil
import time
from pathlib import Path

from ktv.config import CACHE_DIR
from ktv.core import db

log = logging.getLogger("uvicorn.error")

TTL_DAYS = float(os.environ.get("KTV_CACHE_TTL_DAYS", "7"))
EVICT_INTERVAL = 6 * 3600
# A single playback fetches the media in many range requests; record at most
# one access per song per hour instead of writing the database for each.
TOUCH_INTERVAL = 3600

_last_touch: dict[str, float] = {}


async def touch(video_id: str, now: float | None = None) -> None:
    now = time.time() if now is None else now
    if now - _last_touch.get(video_id, 0) < TOUCH_INTERVAL:
        return
    _last_touch[video_id] = now
    await db.touch_video(video_id, int(now))


def _last_used(row: dict | None, job_dir: Path) -> float:
    if row and row.get("processed_at"):
        return row.get("last_accessed") or row["processed_at"]
    # Pending rows and orphan directories (e.g. a download that failed) have no
    # access time of their own; age them by the directory instead.
    return job_dir.stat().st_mtime if job_dir.exists() else 0


async def evict_stale(
    *,
    cache_dir: Path = CACHE_DIR,
    ttl_days: float = TTL_DAYS,
    active: frozenset[str] | set[str] = frozenset(),
    now: float | None = None,
) -> list[str]:
    """Remove songs unused for ttl_days; never touches ids in `active` (jobs in progress)."""
    if ttl_days <= 0:
        return []
    now = time.time() if now is None else now
    cutoff = now - ttl_days * 86400

    rows = {row["video_id"]: row for row in await db.get_all_videos()}
    dirs = {p.name for p in cache_dir.iterdir() if p.is_dir()} if cache_dir.exists() else set()

    evicted = []
    for video_id in sorted(rows.keys() | dirs):
        if video_id in active:
            continue
        row = rows.get(video_id)
        job_dir = cache_dir / video_id
        if _last_used(row, job_dir) >= cutoff:
            continue
        shutil.rmtree(job_dir, ignore_errors=True)
        if row:
            await db.delete_video(video_id)
        _last_touch.pop(video_id, None)
        evicted.append(video_id)
    return evicted


async def evict_forever(active_ids) -> None:
    """Background loop started by the app: evict now, then every EVICT_INTERVAL."""
    while True:
        try:
            evicted = await evict_stale(active=frozenset(active_ids()))
            if evicted:
                log.info("cache: evicted %d song(s) unused for %g days: %s",
                         len(evicted), TTL_DAYS, ", ".join(evicted))
        except Exception:
            log.exception("cache: eviction failed")
        await asyncio.sleep(EVICT_INTERVAL)
