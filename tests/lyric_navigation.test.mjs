import assert from 'node:assert/strict';
import test from 'node:test';
import { getNavigationTime } from '../src/ktv/static/js/lrc.js';

const lines = [5, 12, 20, 32].map(time => ({ time, text: `Line ${time}` }));

test('left and right navigate lyrics instead of a fixed interval', () => {
  assert.equal(getNavigationTime(lines, 15, -1), 5);
  assert.equal(getNavigationTime(lines, 15, 1), 20);
});

test('navigation honors saved lyric offsets and repeated jumps', () => {
  const next = getNavigationTime(lines, 13, 1, 2);
  assert.equal(next, 18);
  assert.equal(getNavigationTime(lines, next, 1, 2), 30);
  assert.equal(getNavigationTime(lines, next, -1, 2), 10);
});

test('the intro and final lyric do not wrap or jump backwards on next', () => {
  assert.equal(getNavigationTime(lines, 1, -1), 0);
  assert.equal(getNavigationTime(lines, 1, 1), 5);
  assert.equal(getNavigationTime(lines, 40, 1), 40);
  assert.equal(getNavigationTime(lines, 6, -1), 5);
});

test('simultaneous lyric timestamps are skipped as one position', () => {
  const duplicate = [5, 12, 12, 20].map(time => ({time}));
  assert.equal(getNavigationTime(duplicate, 12, -1), 5);
  assert.equal(getNavigationTime(duplicate, 12, 1), 20);
});

test('rounding a saved offset does not skip an extra line on previous', () => {
  const decimal = [5.1, 12.3, 20.5].map(time => ({time}));
  assert.ok(Math.abs(getNavigationTime(decimal, 20.5 - 0.2 - 1e-12, -1, 0.2) - 12.1) < 1e-9);
});

test('without synchronized lyrics navigation falls back to five seconds', () => {
  assert.equal(getNavigationTime([], 15, -1), 10);
  assert.equal(getNavigationTime([], 15, 1), 20);
  assert.equal(getNavigationTime([], 2, -1), 0);
  assert.equal(getNavigationTime([], 18, 1, 0, 20), 20);
});

test('offsets cannot seek before the beginning or beyond the video duration', () => {
  assert.equal(getNavigationTime(lines, 0, -1, 8), 0);
  assert.equal(getNavigationTime(lines, 15, 1, -10, 24), 22);
  assert.equal(getNavigationTime(lines, 23, 1, -10, 24), 24);
});
