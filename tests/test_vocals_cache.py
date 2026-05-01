import tempfile
import unittest
from pathlib import Path

import ktv.core.separator as separator


class SeparatedAudioCacheTests(unittest.TestCase):
    def test_cache_is_ready_only_when_instrumental_and_vocals_exist(self):
        original_cache_dir = separator.CACHE_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                separator.CACHE_DIR = Path(tmp)
                job_dir = separator.CACHE_DIR / "abc123"
                job_dir.mkdir()

                self.assertFalse(separator.separated_audio_ready("abc123"))

                (job_dir / "no_vocals.webm").write_bytes(b"instrumental")
                self.assertFalse(separator.separated_audio_ready("abc123"))

                (job_dir / "vocals.webm").write_bytes(b"vocals")
                self.assertTrue(separator.separated_audio_ready("abc123"))
        finally:
            separator.CACHE_DIR = original_cache_dir

    def test_successful_separation_cleanup_removes_original_audio_input(self):
        original_cache_dir = separator.CACHE_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                separator.CACHE_DIR = Path(tmp)
                job_dir = separator.CACHE_DIR / "abc123"
                job_dir.mkdir()
                audio_path = job_dir / "audio.webm"
                wav_path = job_dir / "audio.wav"
                audio_path.write_bytes(b"original")
                wav_path.write_bytes(b"decoded")

                separator.cleanup_separation_sources("abc123")

                self.assertFalse(audio_path.exists())
                self.assertFalse(wav_path.exists())
        finally:
            separator.CACHE_DIR = original_cache_dir


if __name__ == "__main__":
    unittest.main()
