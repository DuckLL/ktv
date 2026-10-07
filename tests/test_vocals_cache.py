import json
import tempfile
import unittest
from pathlib import Path

import ktv.core.separator as separator


class SeparatedAudioCacheTests(unittest.TestCase):
    def test_cache_requires_source_accompaniment_and_current_profile(self):
        original_cache_dir = separator.CACHE_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                separator.CACHE_DIR = Path(tmp)
                job_dir = separator.CACHE_DIR / "abc123"
                job_dir.mkdir()

                self.assertFalse(separator.separated_audio_ready("abc123"))

                (job_dir / "no_vocals.webm").write_bytes(b"instrumental")
                self.assertFalse(separator.separated_audio_ready("abc123"))

                (job_dir / "original.m4a").write_bytes(b"original")
                self.assertFalse(separator.separated_audio_ready("abc123"))
                (job_dir / "separation.json").write_text(json.dumps(separator.SEPARATION_PROFILE))
                self.assertTrue(separator.separated_audio_ready("abc123"))
                (job_dir / "separation.json").write_text(json.dumps({"backend": "old-model"}))
                self.assertFalse(separator.separated_audio_ready("abc123"))
        finally:
            separator.CACHE_DIR = original_cache_dir

    def test_successful_cleanup_preserves_original_and_removes_intermediates(self):
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
                (job_dir / "vocals.webm").write_bytes(b"old vocal stem")

                separator.cleanup_separation_sources("abc123")

                self.assertTrue(audio_path.exists())
                self.assertFalse(wav_path.exists())
                self.assertFalse((job_dir / "vocals.webm").exists())
        finally:
            separator.CACHE_DIR = original_cache_dir


if __name__ == "__main__":
    unittest.main()
