"""Verify the actual pitch, tempo and channel alignment of the FFmpeg pipeline."""

import array
import math
import shutil
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

from ktv.core.transpose import transposed_audio


class TransposedAudioTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which("ffmpeg"):
            raise unittest.SkipTest("ffmpeg is unavailable")
        filters = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True, check=True)
        if "rubberband" not in filters.stdout:
            raise unittest.SkipTest("ffmpeg lacks rubberband")

    async def test_transposition_changes_pitch_but_preserves_duration_stereo_and_track_alignment(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            source = directory / "source.wav"
            samples = array.array("h")
            for i in range(44100 * 3):
                amplitude = 8000 if 22050 <= i < 110250 else 0
                samples.extend(round(amplitude * math.sin(2 * math.pi * hz * i / 44100)) for hz in (440, 660))
            with wave.open(str(source), "wb") as wav:
                wav.setnchannels(2)
                wav.setsampwidth(2)
                wav.setframerate(44100)
                wav.writeframes(samples.tobytes())
            subprocess.run([
                "ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(source),
                "-c:a", "libopus", "-b:a", "256k", str(directory / "no_vocals.webm"),
            ], check=True)
            shutil.copyfile(directory / "no_vocals.webm", directory / "original.webm")
            for key in (-6, 3, 6):
                with self.subTest(key=key):
                    paths = await transposed_audio(directory, key)
                    tracks = []
                    for path in paths.values():
                        output = subprocess.run([
                            "ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
                            "-ar", "48000", "-ac", "2", "-f", "f32le", "-",
                        ], capture_output=True, check=True)
                        pcm = array.array("f")
                        pcm.frombytes(output.stdout)
                        tracks.append(pcm)
                    self.assertAlmostEqual(len(tracks[0]) / 2 / 48000, 3, delta=0.025)
                    self.assertEqual(len(tracks[0]), len(tracks[1]))
                    # Allow codec noise and brief analysis transients, then
                    # separately verify that the best alignment is zero samples.
                    energy = sum(sample * sample for sample in tracks[0])
                    difference = sum((a - b) ** 2 for a, b in zip(*tracks))
                    self.assertLess(math.sqrt(difference / energy), 0.05, "The two copies of the music lost phase alignment")
                    steady = [np.asarray(track).reshape(-1, 2)[36000:108000] for track in tracks]
                    a = steady[0][2:-2]

                    def correlation(lag):
                        b = steady[1][2 + lag:len(steady[1]) - 2 + lag]
                        return float(np.sum(a * b) / np.sqrt(np.sum(a * a) * np.sum(b * b)))

                    self.assertEqual(max(range(-2, 3), key=correlation), 0)
                    for channel, original_hz in enumerate((440, 660)):
                        channel_samples = tracks[0][channel::2]
                        audible = [i for i, sample in enumerate(channel_samples) if abs(sample) > 0.05]
                        self.assertAlmostEqual(audible[0] / 48000, 0.5, delta=0.04)
                        self.assertAlmostEqual(audible[-1] / 48000, 2.5, delta=0.04)
                        mono = channel_samples[36000:108000]
                        spectrum = np.abs(np.fft.rfft(np.asarray(mono) * np.hanning(len(mono))))
                        measured_hz = int(np.argmax(spectrum)) * 48000 / len(mono)
                        self.assertAlmostEqual(measured_hz, original_hz * 2 ** (key / 12), delta=2)


if __name__ == "__main__":
    unittest.main()
