import tempfile
import unittest
from pathlib import Path
from unittest import mock

from yt_dlp.utils import DownloadError

import ktv.core.downloader as downloader


class FakeYoutubeDL:
    """Plays back a script of outcomes, one per YoutubeDL(...) instance."""

    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def __call__(self, opts):
        self.calls += 1
        outcome = self.outcomes.pop(0)
        out = Path(opts["outtmpl"])
        fake = mock.MagicMock()
        fake.__enter__.return_value = fake

        def extract_info(url, download):
            if isinstance(outcome, Exception):
                out.with_name(out.name + ".part").write_text("partial")
                raise outcome
            out.write_text("media")
            return outcome

        fake.extract_info.side_effect = extract_info
        return fake


def forbidden():
    return DownloadError("ERROR: unable to download video data: HTTP Error 403: Forbidden")


class DownloadRetryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name) / "audio.webm"
        self.opts = {"format": "bestaudio", "outtmpl": str(self.out)}
        self.slept = []

    def tearDown(self):
        self.tmp.cleanup()

    def run_with(self, outcomes):
        fake = FakeYoutubeDL(outcomes)
        with mock.patch.object(downloader.yt_dlp, "YoutubeDL", fake):
            result = downloader._download_with_retry(self.opts, "url", sleep=self.slept.append)
        return fake, result

    def test_403_is_retried_with_a_fresh_extraction(self):
        fake, info = self.run_with([forbidden(), {"format_id": "251"}])

        self.assertEqual(info, {"format_id": "251"})
        self.assertEqual(fake.calls, 2)
        self.assertEqual(self.slept, [downloader.RETRY_DELAY])
        self.assertFalse(self.out.with_name("audio.webm.part").exists())
        self.assertEqual(self.out.read_text(), "media")

    def test_other_errors_are_not_retried(self):
        fake = FakeYoutubeDL([DownloadError("ERROR: Video unavailable")])
        with mock.patch.object(downloader.yt_dlp, "YoutubeDL", fake):
            with self.assertRaisesRegex(DownloadError, "Video unavailable"):
                downloader._download_with_retry(self.opts, "url", sleep=self.slept.append)

        self.assertEqual(fake.calls, 1)
        self.assertEqual(self.slept, [])

    def test_gives_up_after_the_last_attempt(self):
        fake = FakeYoutubeDL([forbidden() for _ in range(downloader.DOWNLOAD_ATTEMPTS)])
        with mock.patch.object(downloader.yt_dlp, "YoutubeDL", fake):
            with self.assertRaisesRegex(DownloadError, "403"):
                downloader._download_with_retry(self.opts, "url", sleep=self.slept.append)

        self.assertEqual(fake.calls, downloader.DOWNLOAD_ATTEMPTS)
        self.assertEqual(len(self.slept), downloader.DOWNLOAD_ATTEMPTS - 1)


if __name__ == "__main__":
    unittest.main()
