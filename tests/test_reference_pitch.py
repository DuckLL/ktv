import math
import unittest

import torch

from ktv.core.demucs_worker import reference_pitch


class ReferencePitchTests(unittest.TestCase):
    def test_isolated_a4_yields_midi_contour(self):
        rate = 16000
        samples = torch.arange(rate, dtype=torch.float32)
        tone = 0.25 * torch.sin(2 * math.pi * 440 * samples / rate)
        data = reference_pitch(torch.stack((tone, tone)), rate)

        self.assertEqual(data["version"], 1)
        self.assertEqual(data["hop_seconds"], 0.016)
        voiced = [midi for midi in data["midi"] if midi is not None]
        self.assertGreater(len(voiced), 30)
        self.assertLess(abs(sorted(voiced)[len(voiced) // 2] - 69), 0.2)


if __name__ == "__main__":
    unittest.main()
