import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.responses import FileResponse
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


if __name__ == "__main__":
    unittest.main()
