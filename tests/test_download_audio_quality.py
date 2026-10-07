import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import yt_dlp
from ktv.core import downloader


class DownloadAudioQualityTests(unittest.IsolatedAsyncioTestCase):
    async def test_download_accepts_native_aac_and_records_actual_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []
            def download(opts, url):
                calls.append(opts)
                if opts["format"] == "bestaudio":
                    Path(opts["outtmpl"].replace("%(ext)s", "m4a")).write_bytes(b"native AAC")
                    return {"ext": "m4a", "format_id": "141", "acodec": "mp4a.40.2",
                            "abr": 256, "asr": 44100, "audio_channels": 2}
                Path(opts["outtmpl"]).write_bytes(b"video")
                return {"title": "Track", "artist": "Artist", "duration": 30}
            extractor = MagicMock()
            extractor.__enter__.return_value.extract_info.return_value = {"duration": 30}
            with patch.object(downloader, "CACHE_DIR", Path(tmp)), \
                 patch.object(downloader, "_download_with_retry", side_effect=download), \
                 patch.object(downloader.yt_dlp, "YoutubeDL", return_value=extractor):
                video_id, meta = await downloader.download_video("https://youtu.be/abc12345678")
            audio_opts = calls[-1]
            self.assertNotIn("postprocessors", audio_opts)
            self.assertEqual(audio_opts["format"], "bestaudio")
            source = meta["source_audio"]
            self.assertEqual(source["file"], "original.m4a")
            self.assertEqual(source["bitrate_kbps"], 256)
            self.assertEqual((Path(tmp) / video_id / source["file"]).read_bytes(), b"native AAC")
            self.assertEqual(json.loads((Path(tmp) / video_id / "meta.json").read_text()), meta)
            # Exercise yt-dlp's real sorter with competing containers, rather
            # than checking only the selector string.
            audio_opts = {**audio_opts, "quiet": True}
            with yt_dlp.YoutubeDL(audio_opts) as ydl:
                selected = ydl.process_ie_result({"id": "test", "title": "Test", "formats": [
                    {"format_id": "251", "url": "https://example.test/opus", "ext": "webm",
                     "vcodec": "none", "acodec": "opus", "abr": 160, "asr": 48000, "quality": 3},
                    {"format_id": "141", "url": "https://example.test/aac", "ext": "m4a",
                     "vcodec": "none", "acodec": "mp4a.40.2", "abr": 256, "asr": 44100, "quality": 3},
                ]}, download=False)
            self.assertEqual(selected["format_id"], "141")


if __name__ == "__main__":
    unittest.main()
