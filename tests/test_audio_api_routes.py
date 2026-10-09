import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.responses import FileResponse
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport
import ktv.api.video as video


class AudioApiRouteTests(unittest.IsolatedAsyncioTestCase):
    def test_routes_offer_original_and_accompaniment(self):
        paths = {route.path for route in video.router.routes}
        self.assertIn("/audio/{video_id}/instrumental", paths)
        self.assertIn("/audio/{video_id}/original", paths)
        self.assertIn("/pitch/{video_id}", paths)
        self.assertNotIn("/audio/{video_id}/vocals", paths)

    async def test_original_keeps_native_bytes_and_correct_content_type(self):
        with tempfile.TemporaryDirectory() as tmp:
            job_dir = Path(tmp) / "song"
            job_dir.mkdir()
            source = job_dir / "original.m4a"
            source.write_bytes(b"untouched source")
            with patch.object(video, "CACHE_DIR", Path(tmp)), patch.object(video, "touch", AsyncMock()):
                response = await video.serve_original("song")
            self.assertIsInstance(response, FileResponse)
            self.assertEqual(response.path, source)
            self.assertEqual(response.media_type, "audio/mp4")
            self.assertEqual(source.read_bytes(), b"untouched source")

    async def test_missing_original_requests_reprocessing_instead_of_reconstructed_vocals(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(video, "CACHE_DIR", Path(tmp)):
            response = await video.serve_original("song")
            self.assertEqual(response.status_code, 404)
            self.assertIn("reprocess", json.loads(response.body)["error"])

    async def test_pitch_route_serves_cached_contour(self):
        with tempfile.TemporaryDirectory() as tmp:
            job_dir = Path(tmp) / "song"
            job_dir.mkdir()
            contour = job_dir / "pitch.json"
            contour.write_text('{"version":1,"hop_seconds":0.016,"midi":[69]}')
            with patch.object(video, "CACHE_DIR", Path(tmp)), patch.object(video, "touch", AsyncMock()):
                response = await video.serve_pitch("song")
            self.assertIsInstance(response, FileResponse)
            self.assertEqual(response.path, contour)
            self.assertEqual(response.media_type, "application/json")

    async def test_shifted_original_is_served_as_webm_without_changing_zero_key_behavior(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "song"
            directory.mkdir()
            (directory / "original.m4a").write_bytes(b"original")
            shifted = directory / "shifted.webm"
            with patch.object(video, "CACHE_DIR", Path(tmp)), patch.object(video, "touch", AsyncMock()), patch.object(video, "transposed_audio", AsyncMock(return_value={"original": shifted})) as render:
                response = await video.serve_original("song", key=-2)
            self.assertEqual(response.path, shifted)
            self.assertEqual(response.media_type, "audio/webm")
            render.assert_awaited_once_with(directory, -2)

    async def test_key_query_rejects_invalid_values_before_loading_media(self):
        app = FastAPI()
        app.include_router(video.router)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            for key in ("7", "-7", "1.5", "invalid"):
                with self.subTest(key=key):
                    response = await client.get(f"/audio/song/instrumental?key={key}")
                    self.assertEqual(response.status_code, 422)

    async def test_render_failure_returns_retryable_error(self):
        with patch.object(video, "transposed_audio", AsyncMock(side_effect=RuntimeError("failed"))):
            response = await video.serve_key("song", "instrumental", 2)
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
