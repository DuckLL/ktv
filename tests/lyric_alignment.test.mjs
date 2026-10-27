import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestLyricOffset } from '../src/ktv/static/js/lyric_alignment.js';

test('consistent vocal starts correct the offset with the right sign', () => {
  const reference = { hop_seconds: 0.02, midi: Array(1600).fill(null) };
  const times = [2, 5.4, 9.1, 14, 19.6, 25];
  for (const time of times) reference.midi.fill(69, Math.round(time / 0.02), Math.round((time + 1) / 0.02));
  const lines = times.map(time => ({ time: time + 0.4, text: 'line' }));
  const result = suggestLyricOffset(lines, reference);
  assert.ok(result);
  assert.ok(Math.abs(result.offset - 0.4) < 0.03);
  assert.equal(result.matched, times.length);
  assert.equal(suggestLyricOffset(lines, reference, 0.4), null);
});

test('insufficient or ambiguous vocal evidence does not invent a correction', () => {
  assert.equal(suggestLyricOffset([{time: 2, text: 'x'}], null), null);
  const reference = { hop_seconds: 0.02, midi: Array(1600).fill(69) };
  assert.equal(suggestLyricOffset([2, 5, 8, 12].map(time => ({time, text:'x'})), reference), null);
});
