import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateMixVolumes,
  formatVolumePercent,
  getMixButtonState,
  normalizeMixAmount,
  volumeToSliderValue,
} from '../src/ktv/static/js/audio_mix.js';

test('normalizeMixAmount clamps to the supported slider range', () => {
  assert.equal(normalizeMixAmount(-0.25), 0);
  assert.equal(normalizeMixAmount(0.125), 0.13);
  assert.equal(normalizeMixAmount(1.5), 1);
});

test('formatVolumePercent displays a clamped whole-number percentage', () => {
  assert.equal(formatVolumePercent(0.8), '80%');
  assert.equal(formatVolumePercent(0.045), '5%');
  assert.equal(formatVolumePercent(1.25), '100%');
  assert.equal(formatVolumePercent(Number.NaN), '0%');
});

test('volumeToSliderValue converts volume to a clamped slider value', () => {
  assert.equal(volumeToSliderValue(0.8), '80');
  assert.equal(volumeToSliderValue(0.045), '5');
  assert.equal(volumeToSliderValue(1.25), '100');
  assert.equal(volumeToSliderValue(Number.NaN), '0');
});

test('calculateMixVolumes keeps accompaniment only at the default mix', () => {
  assert.deepEqual(calculateMixVolumes(0.8, 0), {
    instrumental: 0.8,
    vocal: 0,
  });
});

test('calculateMixVolumes applies a squared vocal guide curve without lowering accompaniment', () => {
  assert.deepEqual(calculateMixVolumes(0.8, 0.1), {
    instrumental: 0.8,
    vocal: 0.01,
  });
  assert.deepEqual(calculateMixVolumes(0.8, 0.25), {
    instrumental: 0.8,
    vocal: 0.05,
  });
  assert.deepEqual(calculateMixVolumes(0.8, 0.5), {
    instrumental: 0.8,
    vocal: 0.2,
  });
  assert.deepEqual(calculateMixVolumes(0.8, 1), {
    instrumental: 0.8,
    vocal: 0.8,
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
