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


if __name__ == "__main__":
    unittest.main()
