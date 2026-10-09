import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import ktv.core.transpose as transpose


class TransposeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        (self.directory / "no_vocals.webm").write_bytes(b"instrumental")
        (self.directory / "original.m4a").write_bytes(b"original")

    async def render(self, instrumental, original, key, paths):
        for path in paths.values():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"shifted")

    async def test_original_key_keeps_native_source_files(self):
        with patch.object(transpose, "_render", AsyncMock()) as render:
            paths = await transpose.transposed_audio(self.directory, 0)
        self.assertEqual(paths["original"], self.directory / "original.m4a")
        render.assert_not_called()

    async def test_completed_keys_are_reused_and_source_changes_invalidate_them(self):
        with patch.object(transpose, "_render", AsyncMock(side_effect=self.render)) as render:
            first = await transpose.transposed_audio(self.directory, -3)
            self.assertEqual(await transpose.transposed_audio(self.directory, -3), first)
            self.assertEqual(render.await_count, 1)
            (self.directory / "no_vocals.webm").write_bytes(b"reprocessed instrumental")
            second = await transpose.transposed_audio(self.directory, -3)
            self.assertNotEqual(first, second)
            self.assertEqual(render.await_count, 2)

    async def test_simultaneous_track_requests_share_one_render_and_survive_client_cancellation(self):
        started = asyncio.Event()
        release = asyncio.Event()

        async def delayed(*args):
            started.set()
            await release.wait()
            await self.render(*args)

        with patch.object(transpose, "_render", AsyncMock(side_effect=delayed)) as render:
            first = asyncio.create_task(transpose.transposed_audio(self.directory, 2))
            await started.wait()
            second = asyncio.create_task(transpose.transposed_audio(self.directory, 2))
            await asyncio.sleep(0)
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first
            release.set()
            paths = await second
        self.assertTrue(all(path.is_file() for path in paths.values()))
        self.assertEqual(render.await_count, 1)

    async def test_failed_render_can_be_retried(self):
        with patch.object(transpose, "_render", AsyncMock(side_effect=RuntimeError("failed"))):
            with self.assertRaises(RuntimeError):
                await transpose.transposed_audio(self.directory, 1)
        with patch.object(transpose, "_render", AsyncMock(side_effect=self.render)):
            paths = await transpose.transposed_audio(self.directory, 1)
        self.assertTrue(all(path.is_file() for path in paths.values()))

    async def test_out_of_range_or_fractional_keys_are_rejected(self):
        for key in (-7, 7, 1.5):
            with self.subTest(key=key), self.assertRaises(ValueError):
                await transpose.transposed_audio(self.directory, key)


if __name__ == "__main__":
    unittest.main()
