import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

import ktv.core.cache as cache
import ktv.core.db as db_module

DAY = 86400
NOW = 1_800_000_000


def make_song_dir(cache_dir: Path, video_id: str, mtime: float = NOW) -> Path:
    job_dir = cache_dir / video_id
    job_dir.mkdir()
    for name in ("video_only.webm", "no_vocals.webm", "vocals.webm", "meta.json"):
        (job_dir / name).write_text("x")
    os.utime(job_dir, (mtime, mtime))
    return job_dir


class CacheEvictionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.original_db_path = db_module.DB_PATH
        db_module.DB_PATH = Path(self.tmp.name) / "ktv.db"
        await db_module.init_db()
        self.cache_dir = Path(self.tmp.name) / "cache"
        self.cache_dir.mkdir()
        cache._last_touch.clear()

    async def asyncTearDown(self):
        db_module.DB_PATH = self.original_db_path
        self.tmp.cleanup()

    async def add_song(self, video_id: str, processed_at: float, accessed_at: float | None = None):
        make_song_dir(self.cache_dir, video_id, processed_at)
        meta = {"video_id": video_id, "title": video_id, "artist": "a"}
        await db_module.upsert_video(meta, int(processed_at))
        if accessed_at is not None:
            await db_module.touch_video(video_id, int(accessed_at))

    async def evict(self, **kwargs):
        return await cache.evict_stale(cache_dir=self.cache_dir, ttl_days=7, now=NOW, **kwargs)

    async def library_ids(self):
        return {row["video_id"] for row in await db_module.get_all_videos()}

    async def test_recently_played_song_is_kept(self):
        await self.add_song("recent", NOW - 30 * DAY, accessed_at=NOW - 2 * DAY)

        self.assertEqual(await self.evict(), [])
        self.assertTrue((self.cache_dir / "recent").exists())
        self.assertEqual(await self.library_ids(), {"recent"})

    async def test_song_unplayed_for_a_week_is_evicted_but_settings_stay(self):
        await self.add_song("stale", NOW - 30 * DAY, accessed_at=NOW - 8 * DAY)
        await db_module.set_selection("stale", "42", "Track", "Artist", "[00:01]x")
        await db_module.set_offset("stale", "42", 1.5)

        self.assertEqual(await self.evict(), ["stale"])
        self.assertFalse((self.cache_dir / "stale").exists())
        self.assertEqual(await self.library_ids(), set())
        self.assertIsNotNone(await db_module.get_selection("stale"))
        self.assertEqual(await db_module.get_offset("stale", "42"), 1.5)

    async def test_never_played_song_ages_from_processing_time(self):
        await self.add_song("old", NOW - 10 * DAY)
        await self.add_song("new", NOW - 1 * DAY)

        self.assertEqual(await self.evict(), ["old"])

    async def test_song_being_processed_is_never_evicted(self):
        await db_module.upsert_pending_video("busy")
        make_song_dir(self.cache_dir, "busy", NOW - 30 * DAY)

        self.assertEqual(await self.evict(active={"busy"}), [])
        self.assertTrue((self.cache_dir / "busy").exists())

    async def test_leftovers_of_failed_jobs_age_by_directory(self):
        make_song_dir(self.cache_dir, "orphan_old", NOW - 8 * DAY)
        make_song_dir(self.cache_dir, "orphan_new", NOW - 1 * DAY)
        await db_module.upsert_pending_video("pending_old")
        make_song_dir(self.cache_dir, "pending_old", NOW - 9 * DAY)

        self.assertEqual(await self.evict(), ["orphan_old", "pending_old"])
        self.assertTrue((self.cache_dir / "orphan_new").exists())
        self.assertEqual(await self.library_ids(), set())

    async def test_zero_ttl_disables_eviction(self):
        await self.add_song("stale", NOW - 30 * DAY, accessed_at=NOW - 30 * DAY)

        evicted = await cache.evict_stale(cache_dir=self.cache_dir, ttl_days=0, now=NOW)

        self.assertEqual(evicted, [])
        self.assertTrue((self.cache_dir / "stale").exists())

    async def test_touch_writes_at_most_once_per_hour(self):
        await self.add_song("song", NOW - 30 * DAY)

        await cache.touch("song", now=NOW)
        await cache.touch("song", now=NOW + 600)
        rows = {r["video_id"]: r for r in await db_module.get_all_videos()}
        self.assertEqual(rows["song"]["last_accessed"], NOW)

        await cache.touch("song", now=NOW + 3700)
        rows = {r["video_id"]: r for r in await db_module.get_all_videos()}
        self.assertEqual(rows["song"]["last_accessed"], NOW + 3700)


class LastAccessedMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_old_database_gains_last_accessed_column(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ktv.db"
            con = sqlite3.connect(path)
            con.execute(
                "CREATE TABLE videos (video_id TEXT PRIMARY KEY, title TEXT, artist TEXT,"
                " duration INTEGER, thumbnail TEXT, processed_at INTEGER)"
            )
            con.execute("INSERT INTO videos VALUES ('old', 't', 'a', 1, NULL, 100)")
            con.commit()
            con.close()

            original = db_module.DB_PATH
            db_module.DB_PATH = path
            try:
                await db_module.init_db()
                await db_module.init_db()  # idempotent
                rows = await db_module.get_all_videos()
            finally:
                db_module.DB_PATH = original

        self.assertEqual(rows[0]["video_id"], "old")
        self.assertIn("last_accessed", rows[0])
        self.assertIsNone(rows[0]["last_accessed"])


if __name__ == "__main__":
    unittest.main()
