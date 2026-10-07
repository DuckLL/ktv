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

test('mix endpoints play only accompaniment or untouched original', () => {
  assert.deepEqual(calculateMixVolumes(0.8, 0), { instrumental: 0.8, original: 0 });
  assert.deepEqual(calculateMixVolumes(0.8, 1), { instrumental: 0, original: 0.8 });
});

test('guide vocals follow the slider linearly while shared music stays at master volume', () => {
  for (let percent = 0; percent <= 100; percent++) {
    const mix = percent / 100;
    const gains = calculateMixVolumes(0.8, mix);
    // For source = music + vocals and accompaniment = music, shared music
    // must not double in volume or dip during a crossfade.
    assert.ok(Math.abs(gains.instrumental + gains.original - 0.8) < 1e-12);
    assert.ok(Math.abs(gains.original - 0.8 * mix) < 1e-12);
  }
  assert.deepEqual(calculateMixVolumes(0, 0.75), { instrumental: 0, original: 0 });
});

test('half guide vocal plays the vocals at half amplitude', () => {
  assert.deepEqual(calculateMixVolumes(1, 0.5), { instrumental: 0.5, original: 0.5 });
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
