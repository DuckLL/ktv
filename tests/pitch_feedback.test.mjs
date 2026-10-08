import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/ktv/static/js/pitch_feedback.js', import.meta.url), 'utf8')
  .replace(/from '(\/static\/[^']+)'/g, (_, path) => `from '${new URL(`../src/ktv${path}`, import.meta.url).href}'`);
const { PitchFeedback } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function fixture(t) {
  const elements = new Map();
  const context = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  const element = id => {
    if (!elements.has(id)) elements.set(id, Object.assign(new EventTarget(), {
      checked: false, value: '0', textContent: '', dataset: {}, clientWidth: 640, clientHeight: 240,
      getContext: () => context,
    }));
    return elements.get(id);
  };
  const globals = { document: globalThis.document, window: globalThis.window, requestAnimationFrame: globalThis.requestAnimationFrame };
  t.after(() => Object.assign(globalThis, globals));
  globalThis.document = { getElementById: element };
  globalThis.window = new EventTarget();
  globalThis.requestAnimationFrame = () => {};
  const audio = { offset: 0, startedAt: 0.02, currentTime: 0.2, playing: true, context: { sampleRate: 48000 } };
  const feedback = new PitchFeedback(audio, 'test-song');
  feedback.reference = { hop_seconds: 0.016, midi: Array(500).fill(69) };
  feedback.stream = {};
  feedback.updateChartRange();
  function sing(hz) {
    for (let block = 0; block < 2; block++) {
      const samples = Float32Array.from({ length: 2048 }, (_, i) => 0.25 * Math.sin(2 * Math.PI * hz * (block * 2048 + i) / 48000));
      feedback.onSamples({ samples, endTime: 0.2 + (block + 1) * 2048 / 48000 });
    }
  }
  return { feedback, audio, element, sing };
}

test('octave switch moves the displayed target and grading together without changing audio', t => {
  const { feedback, audio, element, sing } = fixture(t);
  sing(220);
  assert.equal(element('pitchStatus').dataset.grade, 'off');
  const range = { ...feedback.chartRange };
  const clock = { ...audio };
  element('pitchOctaveToggle').checked = true;
  element('pitchOctaveToggle').dispatchEvent(new Event('change'));
  assert.equal(feedback.compared, 0);
  assert.deepEqual(feedback.history, []);
  assert.equal(element('pitchStatus').dataset.grade, '');
  assert.equal(feedback.chartRange.min, range.min - 12);
  assert.equal(feedback.chartRange.max, range.max - 12);
  feedback.draw();
  assert.equal(element('pitchTargetNote').textContent, 'A3');
  sing(220);
  assert.equal(element('pitchStatus').dataset.grade, 'close');
  assert.match(element('pitchResult').textContent, /100%/);
  assert.deepEqual(audio, clock);
  assert.equal(feedback.reference.midi[0], 69);
  element('pitchOctaveToggle').checked = false;
  element('pitchOctaveToggle').dispatchEvent(new Event('change'));
  feedback.draw();
  assert.equal(element('pitchTargetNote').textContent, 'A4');
  assert.deepEqual(feedback.chartRange, range);
});

test('octave practice preserves gaps where the original has no reliable pitch', t => {
  const { feedback, element, sing } = fixture(t);
  feedback.reference.midi.fill(null);
  element('pitchOctaveToggle').checked = true;
  element('pitchOctaveToggle').dispatchEvent(new Event('change'));
  sing(220);
  feedback.draw();
  assert.equal(feedback.compared, 0);
  assert.equal(element('pitchTargetNote').textContent, '—');
  assert.equal(element('pitchStatus').dataset.grade, '');
});
