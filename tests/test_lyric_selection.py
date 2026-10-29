import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import ktv.core.db as db
from ktv.api.selection import router


class LyricSelectionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.original_path = db.DB_PATH
        db.DB_PATH = Path(self.tmp.name) / "lyrics.db"
        await db.init_db()
        app = FastAPI()
        app.include_router(router)
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        db.DB_PATH = self.original_path
        self.tmp.cleanup()

    async def test_clear_forgets_versions_and_offsets_only_for_this_song(self):
        await db.set_selection("song", "wrong", "Wrong", "Artist", None)
        await db.set_offset("song", "wrong", 0.5)
        await db.set_offset("song", "alternate", -0.5)
        await db.set_selection("other", "correct", "Other", "Artist", "[00:01]Other")
        await db.set_offset("other", "correct", 1.0)

        response = await self.client.delete("/selection/song")

        self.assertEqual(response.status_code, 204)
        self.assertIsNone(await db.get_selection("song"))
        self.assertEqual(await db.get_offset("song", "wrong"), 0)
        self.assertEqual(await db.get_offset("song", "alternate"), 0)
        self.assertEqual((await db.get_selection("other"))["lrclib_id"], "correct")
        self.assertEqual(await db.get_offset("other", "correct"), 1.0)

    async def test_clear_persists_so_reload_does_not_automatically_choose_wrong_lyrics(self):
        for _ in range(2):
            self.assertEqual((await self.client.delete("/selection/song")).status_code, 204)
        await db.init_db()

        response = await self.client.get("/selection/song")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"cleared": True})
        self.assertEqual((await self.client.get("/selection/new-song")).status_code, 204)

    async def test_selecting_another_version_replaces_cleared_state(self):
        await self.client.delete("/selection/song")

        response = await self.client.post("/selection/song", json={
            "lrclib_id": "new", "track_name": "Correct", "synced_lyrics": "[00:01]Hello",
        })

        self.assertEqual(response.status_code, 200)
        saved = (await self.client.get("/selection/song")).json()
        self.assertEqual(saved["lrclib_id"], "new")
        self.assertEqual(saved["synced_lyrics"], "[00:01]Hello")
        self.assertFalse(await db.selection_was_cleared("song"))
