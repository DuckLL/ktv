import assert from 'node:assert/strict';
import test from 'node:test';
import { PitchDetector } from '../src/ktv/static/vendor/pitchy/pitchy.js';

test('vendored browser detector follows a sung A4', () => {
  const sampleRate = 48000;
  const signal = Float32Array.from(
    { length: 4096 }, (_, i) => 0.25 * Math.sin(2 * Math.PI * 440 * i / sampleRate),
  );
  const [hz, clarity] = PitchDetector.forFloat32Array(signal.length).findPitch(signal, sampleRate);
  assert.ok(Math.abs(hz - 440) < 5);
  assert.ok(clarity > 0.8);
});
