import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/ktv/static/css/style.css', import.meta.url), 'utf8');

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing CSS block for ${selector}`);
  return match[1];
}

test('player page has mobile layout rules for narrow viewports', () => {
  assert.match(css, /@media\s*\(\s*max-width:\s*760px\s*\)/);
  assert.match(css, /\.player-layout\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.sidebar\s*\{[\s\S]*border-left:\s*none/);
  assert.match(css, /\.video-controls\s*\{[\s\S]*align-items:\s*stretch/);
  assert.match(css, /\.audio-toggle\s*\{[\s\S]*width:\s*100%/);
  assert.match(css, /\.offset-bar\s*\{[\s\S]*flex-wrap:\s*wrap/);
  assert.match(css, /\.lyrics-stage\s*\{[\s\S]*max-height:\s*10rem/);
});

test('mobile controls can shrink without overflowing narrow screens', () => {
  assert.match(css, /\.player-layout\s*\{[\s\S]*max-width:\s*100%/);
  assert.match(css, /\.video-controls\s*\{[\s\S]*min-width:\s*0/);
  assert.match(css, /\.audio-toggle\s*\{[\s\S]*max-width:\s*100%/);
  assert.match(css, /\.audio-toggle-btn\s*\{[\s\S]*flex:\s*0 0 auto/);
  assert.match(css, /\.mix-slider,\s*\.volume-slider\s*\{[\s\S]*min-width:\s*0/);
  assert.match(css, /\.sidebar-input\s*\{[\s\S]*min-width:\s*0/);
});

test('long player title and artist cannot widen the viewport', () => {
  assert.match(cssBlock('.player-header'), /min-width:\s*0/);
  assert.match(cssBlock('.player-logo'), /flex:\s*0 0 auto/);
  assert.match(cssBlock('.player-title'), /flex:\s*1 1 auto/);
  assert.match(cssBlock('.player-title'), /min-width:\s*0/);
  assert.match(cssBlock('.player-artist'), /overflow:\s*hidden/);
  assert.match(cssBlock('.player-artist'), /text-overflow:\s*ellipsis/);
});
