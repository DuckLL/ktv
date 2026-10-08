import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSongTime, hzToMidi, midiToNote, pitchChartRange, pitchDifferenceCents, pitchFeedback, referenceAt, transposeMidi } from '../src/ktv/static/js/pitch_math.js';

test('pitch comparison uses cents and masks sparse reference frames', () => {
  assert.equal(hzToMidi(440), 69);
  assert.equal(pitchDifferenceCents(hzToMidi(466.1637615), 69), 100);
  assert.equal(pitchFeedback(35).className, 'close');
  assert.equal(pitchFeedback(-85).label, '偏低 85 音分');
  const reference = { hop_seconds: 0.016, midi: [null, 69, 69.1, 69, null, null, null] };
  assert.equal(referenceAt(reference, 0.032), 69);
  assert.equal(referenceAt(reference, 2), null);
  assert.equal(referenceAt(reference, -1), null);
});

test('sample centre maps to the audio clock and applies input delay', () => {
  const audio = { offset: 32, startedAt: 10 };
  assert.equal(captureSongTime(audio, 11.5, 48000, 4800, 0), 33.45);
  assert.equal(captureSongTime(audio, 11.5, 48000, 4800, 200), 33.25);
});

test('chart stays at one readable note scale despite pitch tracking outliers', () => {
  const range = pitchChartRange([40, ...Array(100).fill(60), ...Array(100).fill(72), 100]);
  assert.ok(range.min <= 60 && range.max >= 72);
  assert.ok(range.max - range.min >= 24);
  assert.ok(range.max - range.min <= 38);
  assert.equal(midiToNote(69), 'A4');
  assert.equal(midiToNote(61), 'C♯4');
  assert.equal(midiToNote(null), '—');
});

test('singing one octave lower matches the lowered target without accepting the original octave', () => {
  const target = transposeMidi(hzToMidi(440), -12);
  assert.equal(midiToNote(target), 'A3');
  assert.equal(pitchDifferenceCents(hzToMidi(220), target), 0);
  assert.equal(pitchDifferenceCents(hzToMidi(440), target), 1200);
  assert.equal(transposeMidi(69.25, -12), 57.25);
  assert.equal(transposeMidi(null, -12), null);
});
