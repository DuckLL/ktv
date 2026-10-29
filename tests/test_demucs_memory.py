import asyncio
import os
import signal
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np
import soundfile as sf
import torch

from ktv.core import demucs_worker, separator


class DemucsMemoryTests(unittest.TestCase):
    def test_short_segments_preserve_stereo_gain_and_pitch_input(self):
        model = mock.MagicMock()
        model.cpu.return_value = model
        model.eval.return_value = model
        model.max_allowed_segment = 7.8
        model.models = [SimpleNamespace(segment=7.8)]
        model.samplerate = 8000
        model.audio_channels = 2
        model.sources = ["drums", "bass", "other", "vocals"]
        samples = np.tile([[0.2, -0.4], [-0.2, 0.4]], (4000, 1)).astype("float32")
        captured_vocals = []

        def infer(current_model, audio, **options):
            # Both the chunking loop and the HTDemucs padding limit must shrink.
            self.assertEqual(options["segment"], 4)
            self.assertTrue(all(part.segment == 4 for part in current_model.models))
            return torch.stack([audio * gain for gain in [0.1, 0.2, 0.3, 0.4]], dim=1)

        def pitch(vocals, rate):
            captured_vocals.append(vocals.numpy().T.copy())
            self.assertEqual(rate, 8000)
            return {"version": 1, "hop_seconds": 0.016, "midi": []}

        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.dict(os.environ), \
             mock.patch.object(demucs_worker, "get_model", return_value=model), \
             mock.patch.object(demucs_worker, "apply_model", side_effect=infer), \
             mock.patch.object(demucs_worker, "reference_pitch", side_effect=pitch), \
             mock.patch.object(demucs_worker.os, "nice"):
            os.environ.pop("KTV_DEMUCS_SEGMENT_SECONDS", None)
            source, output, contour = [Path(tmp) / name for name in ["input.wav", "output.wav", "pitch.json"]]
            sf.write(source, samples, 8000, subtype="FLOAT")
            demucs_worker.separate(source, output, contour)
            accompaniment, rate = sf.read(output, dtype="float32", always_2d=True)
            self.assertEqual(rate, 8000)
            np.testing.assert_allclose(accompaniment, samples * 0.6, atol=1e-6)
            np.testing.assert_allclose(captured_vocals[0], samples * 0.4, atol=1e-6)
            self.assertTrue(contour.is_file())

    def test_invalid_segments_fail_before_allocating_song_audio(self):
        model = mock.MagicMock()
        model.max_allowed_segment = 7.8
        for value in ["0", "-1", "8", "nan", "inf"]:
            with self.subTest(segment=value), \
                 mock.patch.dict(os.environ, {"KTV_DEMUCS_SEGMENT_SECONDS": value}), \
                 mock.patch.object(demucs_worker, "get_model", return_value=model), \
                 mock.patch.object(demucs_worker.sf, "read") as read:
                with self.assertRaisesRegex(ValueError, "KTV_DEMUCS_SEGMENT_SECONDS"):
                    demucs_worker.separate(Path("input.wav"), Path("output.wav"), Path("pitch.json"))
                read.assert_not_called()


class SeparationFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_sigkill_explains_possible_memory_exhaustion(self):
        stderr = asyncio.StreamReader()
        stderr.feed_eof()
        decode = SimpleNamespace(returncode=0, wait=mock.AsyncMock())
        worker = SimpleNamespace(returncode=-signal.SIGKILL, wait=mock.AsyncMock(), stderr=stderr)
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(separator, "CACHE_DIR", Path(tmp)), \
             mock.patch.object(separator, "original_audio_path", return_value=Path(tmp) / "original.m4a"), \
             mock.patch.object(separator, "separated_audio_ready", return_value=False), \
             mock.patch.object(separator.asyncio, "create_subprocess_exec", side_effect=[decode, worker]):
            with self.assertRaisesRegex(RuntimeError, "SIGKILL.*記憶體不足"):
                await separator.separate_vocals("song")
