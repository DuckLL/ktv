import tempfile
import unittest
from pathlib import Path

import ktv.core.db as db_module


class PendingLibraryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.original_db_path = db_module.DB_PATH
        db_module.DB_PATH = Path(self.tmp.name) / "ktv.db"
        await db_module.init_db()

    async def asyncTearDown(self):
        db_module.DB_PATH = self.original_db_path
        self.tmp.cleanup()

    async def test_pending_video_appears_in_library_before_processing_finishes(self):
        await db_module.upsert_pending_video("abc123")

        rows = await db_module.get_all_videos()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["video_id"], "abc123")
        self.assertEqual(rows[0]["title"], "abc123")
        self.assertEqual(rows[0]["artist"], "處理中")
        self.assertEqual(rows[0]["processed_at"], 0)

    async def test_pending_videos_sort_before_processed_videos(self):
        await db_module.upsert_video(
            {
                "video_id": "done123",
                "title": "Done Song",
                "artist": "Done Artist",
                "duration": 180,
                "thumbnail": None,
            },
            100,
        )
        await db_module.upsert_pending_video("pending123")

        rows = await db_module.get_all_videos()

        self.assertEqual([row["video_id"] for row in rows], ["pending123", "done123"])

    async def test_final_video_metadata_replaces_pending_row(self):
        await db_module.upsert_pending_video("abc123")
        await db_module.upsert_video(
            {
                "video_id": "abc123",
                "title": "Final Title",
                "artist": "Final Artist",
                "duration": 240,
                "thumbnail": "https://example.test/thumb.jpg",
            },
            456,
        )

        rows = await db_module.get_all_videos()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "Final Title")
        self.assertEqual(rows[0]["artist"], "Final Artist")
        self.assertEqual(rows[0]["processed_at"], 456)

    async def test_failed_video_keeps_its_error_until_it_is_queued_again(self):
        await db_module.upsert_pending_video("abc123")
        await db_module.mark_video_failed("abc123", "HTTP Error 403")

        rows = await db_module.get_all_videos()
        self.assertEqual(rows[0]["error"], "HTTP Error 403")
        self.assertEqual(rows[0]["processed_at"], 0)

        await db_module.upsert_pending_video("abc123")
        rows = await db_module.get_all_videos()
        self.assertIsNone(rows[0]["error"])

    async def test_failure_never_marks_a_finished_video(self):
        await db_module.upsert_video({"video_id": "done123"}, 100)
        await db_module.mark_video_failed("done123", "late error")

        rows = await db_module.get_all_videos()
        self.assertIsNone(rows[0]["error"])

    async def test_restart_marks_unfinished_videos_as_interrupted(self):
        await db_module.upsert_pending_video("pending123")
        await db_module.upsert_pending_video("failed123")
        await db_module.mark_video_failed("failed123", "HTTP Error 403")
        await db_module.upsert_video({"video_id": "done123"}, 100)

        await db_module.mark_interrupted_videos("interrupted")

        errors = {row["video_id"]: row["error"] for row in await db_module.get_all_videos()}
        self.assertEqual(errors, {"pending123": "interrupted", "failed123": "HTTP Error 403", "done123": None})

    async def test_existing_databases_gain_the_error_column(self):
        import aiosqlite

        legacy = Path(self.tmp.name) / "legacy.db"
        async with aiosqlite.connect(legacy) as db:
            await db.execute("CREATE TABLE videos (video_id TEXT PRIMARY KEY, title TEXT, artist TEXT, "
                             "duration INTEGER, thumbnail TEXT, processed_at INTEGER)")
            await db.execute("INSERT INTO videos VALUES ('old123', 'Old', 'Artist', 1, '', 5)")
            await db.commit()
        db_module.DB_PATH = legacy
        await db_module.init_db()

        rows = await db_module.get_all_videos()
        self.assertIsNone(rows[0]["error"])


if __name__ == "__main__":
    unittest.main()
