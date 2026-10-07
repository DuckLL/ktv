import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLrc, rankLyricResults } from '../src/ktv/static/js/lrc.js';

test('a line with several timestamps repeats at each of them', () => {
  assert.deepEqual(parseLrc('[00:12.00][00:45.50]Chorus'), [
    { time: 12, text: 'Chorus' },
    { time: 45.5, text: 'Chorus' },
  ]);
});

test('common timestamp variants parse, metadata tags do not', () => {
  const lines = parseLrc('﻿[ar:Artist]\n[1:05.5]a\r\n[00:50]b\n[00:07.123]c\n[00:08:25]d');
  assert.deepEqual(lines.map(line => [line.time, line.text]), [[7.123, 'c'], [8.25, 'd'], [50, 'b'], [65.5, 'a']]);
});

test('enhanced LRC word timings are removed from the text', () => {
  assert.deepEqual(parseLrc('[00:20.00]<00:20.00>Hello <00:20.50>world'), [{ time: 20, text: 'Hello world' }]);
});

test('empty timestamped lines are kept as instrumental breaks', () => {
  assert.deepEqual(parseLrc('[00:10.00]Line\n[00:15.00]\n[00:30.00]Next'), [
    { time: 10, text: 'Line' },
    { time: 15, text: '' },
    { time: 30, text: 'Next' },
  ]);
});

test('search results list synced lyrics closest to the video length first', () => {
  const items = [
    { id: 1, duration: 200, syncedLyrics: null },
    { id: 2, duration: 260, syncedLyrics: '[00:01.00]x' },
    { id: 3, duration: 241, syncedLyrics: '[00:01.00]x' },
    { id: 4, syncedLyrics: '[00:01.00]x' },
  ];
  assert.deepEqual(rankLyricResults(items, 240).map(item => item.id), [3, 2, 4, 1]);
  assert.deepEqual(rankLyricResults(items, NaN).map(item => item.id), [2, 3, 4, 1]);
  assert.deepEqual(items.map(item => item.id), [1, 2, 3, 4]);
});
