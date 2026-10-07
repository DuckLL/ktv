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
            def download(opts, url, info=None):
                calls.append(opts)
                self.assertEqual(url, "https://www.youtube.com/watch?v=abc12345678")
                self.assertEqual(info, {"duration": 30})
                if opts["format"] == "bestaudio":
                    Path(opts["outtmpl"].replace("%(ext)s", "m4a")).write_bytes(b"native AAC")
                    return {"ext": "m4a", "format_id": "141", "acodec": "mp4a.40.2",
                            "abr": 256, "asr": 44100, "audio_channels": 2}
                Path(opts["outtmpl"]).write_bytes(b"video")
                return {"title": "Track", "artist": "Artist", "duration": 30}
            extract = MagicMock(return_value={"duration": 30})
            with patch.object(downloader, "CACHE_DIR", Path(tmp)), \
                 patch.object(downloader, "_download_with_retry", side_effect=download), \
                 patch.object(downloader, "_extract_info", extract):
                video_id, meta = await downloader.download_video("https://youtu.be/abc12345678")
            # One extraction serves the duration check and both downloads.
            extract.assert_called_once_with("https://www.youtube.com/watch?v=abc12345678")
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

    async def test_playlist_and_mix_urls_download_only_the_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            extract = MagicMock(side_effect=ValueError("stop after extraction"))
            with patch.object(downloader, "CACHE_DIR", Path(tmp)), \
                 patch.object(downloader, "_extract_info", extract):
                with self.assertRaisesRegex(ValueError, "stop after extraction"):
                    await downloader.download_video(
                        "https://www.youtube.com/watch?v=abc12345678&list=RDabc12345678&start_radio=1")
            extract.assert_called_once_with("https://www.youtube.com/watch?v=abc12345678")

    async def test_videos_over_ten_minutes_are_rejected_before_downloading(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(downloader, "CACHE_DIR", Path(tmp)), \
                 patch.object(downloader, "_extract_info", return_value={"duration": 601}), \
                 patch.object(downloader, "_download_with_retry") as download:
                with self.assertRaisesRegex(ValueError, "10 分鐘"):
                    await downloader.download_video("https://youtu.be/abc12345678")
            download.assert_not_called()

    def test_shared_extraction_lets_each_download_choose_its_own_format(self):
        formats = [
            {"format_id": "247", "url": "https://example.test/vp9", "ext": "webm",
             "vcodec": "vp9", "acodec": "none", "height": 720, "tbr": 1500},
            {"format_id": "251", "url": "https://example.test/opus", "ext": "webm",
             "vcodec": "none", "acodec": "opus", "abr": 160, "asr": 48000},
        ]
        def extract_info(ydl, url, download):
            # What a real extraction returns: the IE result after the default format selection.
            return ydl.process_ie_result({"id": "abc12345678", "title": "Test", "formats": formats}, download=False)

        with patch.object(yt_dlp.YoutubeDL, "extract_info", extract_info):
            info = downloader._extract_info("url")
        # The default bestvideo+bestaudio selection must not leak into a single-stream download.
        self.assertNotIn("requested_formats", info)
        with yt_dlp.YoutubeDL({"quiet": True, "format": "bestaudio"}) as ydl:
            selected = ydl.process_ie_result(info, download=False)
        self.assertEqual(selected["format_id"], "251")
        self.assertNotIn("requested_formats", selected)


if __name__ == "__main__":
    unittest.main()
