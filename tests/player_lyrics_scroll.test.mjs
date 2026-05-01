import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playerJs = readFileSync(new URL('../src/ktv/static/js/player.js', import.meta.url), 'utf8');

test('active lyric centering scrolls only the lyrics container', () => {
  assert.doesNotMatch(playerJs, /scrollIntoView/);
  assert.match(playerJs, /function\s+centerLyricInStage/);
  assert.match(playerJs, /lyricsStage\.scrollTo/);
});
