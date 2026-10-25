import json
import math
import tempfile
import unittest
from pathlib import Path

import numpy as np

from ktv.core.pitch import stabilize_midi, note_segments, estimate_beats, prepare_practice_reference


class PracticePitchTests(unittest.TestCase):
    def test_short_octave_error_is_repaired_but_sustained_octave_is_preserved(self):
        raw = [62.9] * 30 + [50.7] * 6 + [63.0] * 30
        clean = stabilize_midi(raw, 0.016)
        self.assertTrue(all(62 < v < 64 for v in clean))
        sustained = stabilize_midi([63] * 30 + [51] * 30 + [63] * 30, 0.016)
        self.assertEqual(sustained[45], 51)

    def test_true_leaps_vibrato_and_rests_survive(self):
        raw = [60 + 0.35 * math.sin(i) for i in range(30)] + [None] * 10 + [67] * 20
        clean = stabilize_midi(raw, 0.016)
        self.assertEqual(clean[30:40], [None] * 10)
        self.assertGreater(max(clean[:30]) - min(clean[:30]), 0.1)
        self.assertEqual(clean[50], 67)
        notes = note_segments(clean, 0.016)
        self.assertEqual(len(notes), 2)
        self.assertEqual(notes[0]["end"], 0.48)
        self.assertEqual(notes[1]["start"], 0.64)

    def test_noise_blips_and_nonfinite_values_do_not_become_notes(self):
        raw = [None] * 10 + [83] * 2 + [None] * 10 + [float('nan'), float('inf'), -200]
        clean = stabilize_midi(raw, 0.016)
        self.assertTrue(all(v is None for v in clean))
        self.assertEqual(note_segments(clean, 0.016), [])

    def test_beat_grid_tracks_clicks_and_rejects_silence(self):
        rate = 8000
        signal = np.zeros(rate * 12, dtype=np.float32)
        click = np.random.default_rng(42).normal(size=160) * np.exp(-np.arange(160) / 30)
        for start in np.arange(0.4, 11.9, 0.5):
            i = round(start * rate)
            signal[i:i + len(click)] = click
        result = estimate_beats(signal, rate)
        self.assertAlmostEqual(result["bpm"], 120, delta=3)
        self.assertGreater(len(result["beats"]), 15)
        for beat in result["beats"][1:-1]:
            self.assertLess(abs((beat - 0.4 + 0.25) % 0.5 - 0.25), 0.08)
        self.assertEqual(estimate_beats(np.zeros(rate * 8)), {"beats": [], "bpm": None})


class PreparedReferenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_existing_raw_cache_is_preserved_and_prepared_cache_is_invalidated(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            source = directory / 'pitch.json'
            raw = {"version": 1, "hop_seconds": 0.016, "midi": [69] * 20 + [81] + [69] * 20}
            source.write_text(json.dumps(raw))
            prepared = await prepare_practice_reference(directory)
            data = json.loads(prepared.read_text())
            self.assertEqual(data['midi'][20], 69)
            self.assertEqual(json.loads(source.read_text()), raw)
            timestamp = prepared.stat().st_mtime_ns
            self.assertEqual(await prepare_practice_reference(directory), prepared)
            self.assertEqual(prepared.stat().st_mtime_ns, timestamp)
            raw['midi'] = [72] * 30
            source.write_text(json.dumps(raw))
            await prepare_practice_reference(directory)
            self.assertEqual(json.loads(prepared.read_text())['midi'][10], 72)


if __name__ == '__main__':
    unittest.main()
