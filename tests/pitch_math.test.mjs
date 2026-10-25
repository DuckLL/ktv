import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSongTime, hzToMidi, midiToNote, pitchChartRange, pitchDifferenceCents, pitchFeedback, referenceAt, transposeMidi, LivePitchTracker, matchReference, PRACTICE_MODES } from '../src/ktv/static/js/pitch_math.js';

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

test('microphone spikes are hidden and a sustained genuine octave is accepted', () => {
  const tracker = new LivePitchTracker();
  assert.equal(tracker.update(60, 0), 60);
  assert.equal(tracker.update(72, 0.04), null);
  assert.equal(tracker.update(60, 0.08), 60);
  assert.equal(tracker.update(48, 0.12), null);
  assert.equal(tracker.update(48, 0.16), null);
  assert.equal(tracker.update(48, 0.22), 48);
  tracker.update(null, 0.5);
  assert.equal(tracker.update(72, 0.6), 72);
});

test('timing grace accepts a slightly late note, but never bridges rests or ignores an octave', () => {
  const reference = { hop_seconds: 0.02, midi: [...Array(20).fill(60), ...Array(20).fill(64), ...Array(20).fill(null), ...Array(20).fill(67)] };
  assert.equal(matchReference(reference, 0.44, 60, 0, 0.12), 60);
  assert.equal(matchReference(reference, 0.6, 60, 0, 0.12), 64);
  assert.equal(matchReference(reference, 0.9, 64, 0, 0.18), null);
  assert.equal(matchReference(reference, 1.2, 64, 0, 0.18), 67);
  assert.equal(pitchDifferenceCents(72, matchReference(reference, 0.2, 72, 0, 0.12)), 1200);
  assert.equal(pitchFeedback(75, PRACTICE_MODES.practice.cents).className, 'close');
  assert.equal(pitchFeedback(90, PRACTICE_MODES.practice.cents).className, 'off');
});

test('audible output latency and manual microphone correction share the song clock', () => {
  const audio = { offset: 32, startedAt: 10, context: { baseLatency: 0.02, outputLatency: 0.08 } };
  assert.ok(Math.abs(captureSongTime(audio, 11.5, 48000, 4800, 150) - 33.2) < 1e-8);
});
