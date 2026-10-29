import assert from 'node:assert/strict';
import test from 'node:test';
import { currentPitchPoint, localPitchBounds, PitchViewport } from '../src/ktv/static/js/pitch_viewport.js';

test('the view follows the nearby phrase rather than the entire song, ignoring isolated spikes', () => {
  const midi = [...Array(1000).fill(60), ...Array(1000).fill(84)];
  midi[200] = 100;
  const reference = { hop_seconds: 0.02, midi };
  assert.deepEqual(localPitchBounds(reference, 4), { min: 60, max: 60 });
  assert.deepEqual(localPitchBounds(reference, 24, -12), { min: 72, max: 72 });
  const view = new PitchViewport();
  const range = view.update(localPitchBounds(reference, 4), 4, 0);
  assert.equal(range.max - range.min, 10);
  assert.ok(range.min < 60 && range.max > 60);
});

test('stable off-target singing stays absolute and transient microphone spikes do not resize the view', () => {
  const reference = { hop_seconds: 0.02, midi: Array(500).fill(69) };
  const history = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1].map(time => ({ time, midi: 57 }));
  const copy = structuredClone({ reference, history });
  history.at(-1).midi = 95;
  assert.deepEqual(localPitchBounds(reference, 1, 0, history), { min: 57, max: 69 });
  history.at(-1).midi = 57;
  assert.deepEqual({ reference, history }, copy);
  assert.deepEqual(localPitchBounds(reference, 1, 0, [{ time: 1, midi: 95 }]), { min: 69, max: 69 });
  assert.deepEqual(localPitchBounds(reference, 2, 0, history), { min: 69, max: 69 });
});

test('small pitch and vibrato changes leave the axis completely still', () => {
  const view = new PitchViewport();
  const initial = view.update({ min: 67, max: 71 }, 0, 0);
  for (let i = 1; i <= 600; i++) {
    const wobble = 0.25 * Math.sin(i);
    assert.deepEqual(view.update({ min: 67 + wobble, max: 71 + wobble }, i / 60, i / 60), initial);
  }
});

test('a phrase change pans and expands smoothly with a bounded speed', () => {
  const view = new PitchViewport();
  let previous = view.update({ min: 60, max: 60 }, 0, 0);
  for (let i = 1; i <= 180; i++) {
    const range = view.update({ min: 67, max: 79 }, i / 60, i / 60);
    const centerChange = (range.min + range.max - previous.min - previous.max) / 2;
    const spanChange = range.max - range.min - (previous.max - previous.min);
    assert.ok(centerChange >= 0 && centerChange <= 6 / 60 + 1e-9);
    assert.ok(spanChange >= 0 && spanChange <= 12 / 60 + 1e-9);
    previous = range;
  }
  assert.ok(previous.min < 67 && previous.max > 79);
  assert.ok(Math.abs((previous.min + previous.max) / 2 - 73) < 0.5);
});

test('zooming back in waits for a stable narrower phrase and rests preserve the last scale', () => {
  const view = new PitchViewport();
  const initial = view.update({ min: 60, max: 80 }, 0, 0);
  for (let i = 1; i <= 90; i++) {
    const range = view.update({ min: 68, max: 72 }, i / 60, i / 60);
    assert.equal(range.max - range.min, initial.max - initial.min);
  }
  let range;
  for (let i = 91; i <= 360; i++) range = view.update({ min: 68, max: 72 }, i / 60, i / 60);
  assert.ok(range.max - range.min < 11);
  const center = (range.min + range.max) / 2;
  for (let i = 361; i <= 480; i++) range = view.update(null, i / 60, i / 60);
  assert.equal((range.min + range.max) / 2, center);
  assert.ok(range.max - range.min < 11);
});

test('frame rates preserve the same motion and seeking immediately frames the destination', () => {
  const atRate = fps => {
    const view = new PitchViewport();
    view.update({ min: 60, max: 60 }, 0, 0);
    let range;
    for (let i = 1; i <= fps; i++) range = view.update({ min: 65, max: 69 }, i / fps, i / fps);
    return range;
  };
  const slow = atRate(30), fast = atRate(120);
  assert.ok(Math.abs(slow.min - fast.min) < 0.05);
  assert.ok(Math.abs(slow.max - fast.max) < 0.05);
  const view = new PitchViewport();
  view.update({ min: 60, max: 60 }, 0, 0);
  assert.deepEqual(view.update({ min: 84, max: 84 }, 40, 0.02), { min: 79, max: 89 });
  assert.deepEqual(view.update({ min: 48, max: 48 }, 2, 0.04), { min: 43, max: 53 });
  view.reset();
  assert.deepEqual(view.update({ min: 57, max: 57 }, 2, 0.06), { min: 52, max: 62 });
});

test('empty reference and silent or missing microphone frames never create a pitch', () => {
  const reference = { hop_seconds: 0.02, midi: Array(500).fill(null) };
  assert.equal(localPitchBounds(reference, 1, 0, [{ time: 1, midi: null }]), null);
  const view = new PitchViewport();
  assert.deepEqual(view.update(null, 0, 0, { min: 48, max: 72 }), { min: 48, max: 72 });
});

test('microphone latency correction keeps a fresh marker and singer range without keeping stale sound', () => {
  const reference = { hop_seconds: 0.02, midi: Array(500).fill(69) };
  for (const correction of [-0.3, 0.6]) {
    const history = [0.8, 0.85, 0.9, 0.95].map(time => ({ time: time - correction, receivedAt: time, midi: 57 }));
    assert.equal(currentPitchPoint(history, 1), history.at(-1));
    assert.deepEqual(localPitchBounds(reference, 1, 0, history), { min: 57, max: 69 });
    assert.equal(currentPitchPoint(history, 1.5), null);
    assert.deepEqual(localPitchBounds(reference, 1.5, 0, history), { min: 69, max: 69 });
    history.push({ time: 1 - correction, receivedAt: 1, midi: null });
    assert.equal(currentPitchPoint(history, 1), null);
  }
});
