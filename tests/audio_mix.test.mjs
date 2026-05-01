import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateMixVolumes,
  getMixButtonState,
  normalizeMixAmount,
} from '../src/ktv/static/js/audio_mix.js';

test('normalizeMixAmount clamps to the supported slider range', () => {
  assert.equal(normalizeMixAmount(-0.25), 0);
  assert.equal(normalizeMixAmount(0.125), 0.13);
  assert.equal(normalizeMixAmount(1.5), 1);
});

test('calculateMixVolumes keeps accompaniment only at the default mix', () => {
  assert.deepEqual(calculateMixVolumes(0.8, 0), {
    instrumental: 0.8,
    vocal: 0,
  });
});

test('calculateMixVolumes adds vocal guide without lowering accompaniment', () => {
  assert.deepEqual(calculateMixVolumes(0.8, 0.1), {
    instrumental: 0.8,
    vocal: 0.08,
  });
  assert.deepEqual(calculateMixVolumes(0.8, 0.5), {
    instrumental: 0.8,
    vocal: 0.4,
  });
});

test('getMixButtonState activates buttons only at pure endpoints', () => {
  assert.deepEqual(getMixButtonState(0), {
    instrumental: true,
    vocal: false,
  });
  assert.deepEqual(getMixButtonState(0.5), {
    instrumental: false,
    vocal: false,
  });
  assert.deepEqual(getMixButtonState(1), {
    instrumental: false,
    vocal: true,
  });
});
