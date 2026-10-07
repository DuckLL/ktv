import assert from 'node:assert/strict';
import test from 'node:test';
import { SynchronizedAudioPlayer } from '../src/ktv/static/js/audio_player.js';

function fixture(fetchAudio = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })) {
  const starts = [];
  const fetched = [];
  const context = {
    currentTime: 10,
    destination: {},
    resume: async () => {},
    decodeAudioData: async () => ({ duration: 180 }),
    createGain: () => ({ connect() {}, gain: { cancelScheduledValues() {}, setTargetAtTime() {} } }),
    createBufferSource: () => ({
      connect() {}, disconnect() {}, stop() {},
      start: (...args) => starts.push(args),
    }),
  };
  const recordFetch = url => { fetched.push(url); return fetchAudio(url); };
  return { context, starts, fetched, player: new SynchronizedAudioPlayer(['instrumental', 'original'], context, recordFetch) };
}

test('overlapping accompaniment starts at exactly the same clock time and offset', async () => {
  const { player, starts } = fixture();
  await player.loadTrack(1);
  await player.play(25);
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[0], starts[1]);
  assert.deepEqual(starts[0], [10.02, 25]);
});

test('seek and pause preserve the shared timeline', async () => {
  const { player, starts, context } = fixture();
  await player.loadTrack(1);
  await player.play(5);
  context.currentTime = 13.02;
  assert.ok(Math.abs(player.currentTime - 8) < 1e-12);
  player.seek(30);
  assert.deepEqual(starts.at(-1), starts.at(-2));
  context.currentTime += 2.02;
  player.pause();
  assert.ok(Math.abs(player.currentTime - 32) < 1e-12);
  context.currentTime += 10;
  assert.ok(Math.abs(player.currentTime - 32) < 1e-12);
});

test('pausing during audio loading prevents a late audible start', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const { player, starts } = fixture(async () => {
    await pending;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
  });
  const playing = player.play(0);
  player.pause();
  resolve();
  await playing;
  assert.equal(player.playing, false);
  assert.equal(starts.length, 0);
});

test('initial playback uses the current video time after downloads finish', async () => {
  const { player, starts } = fixture();
  let time = 1;
  const playing = player.play(() => time);
  time = 7;
  await playing;
  assert.equal(starts[0][1], 7);
});

test('large audio decoders do not run concurrently on mobile', async () => {
  const { player, context } = fixture();
  let beginFirst, finishFirst;
  const started = new Promise(resolve => { beginFirst = resolve; });
  const blocked = new Promise(resolve => { finishFirst = resolve; });
  let calls = 0;
  context.decodeAudioData = async () => {
    calls++;
    if (calls === 1) {
      beginFirst();
      await blocked;
    }
    return { duration: 180 };
  };
  const loading = Promise.all([player.load(), player.loadTrack(1)]);
  await started;
  await new Promise(resolve => setTimeout(resolve));
  assert.equal(calls, 1);
  finishFirst();
  await loading;
  assert.equal(calls, 2);
  await player.load();
  assert.equal(calls, 2);
});

test('playback needs only the accompaniment; the original can load afterwards', async () => {
  const { player, starts, fetched } = fixture();
  await player.play(0);
  assert.deepEqual(fetched, ['instrumental']);
  assert.equal(starts.length, 1);
});

test('an original loaded mid-song joins the running clock exactly', async () => {
  const { player, starts, context } = fixture();
  await player.play(5);
  context.currentTime = 14;
  await player.loadTrack(1);
  assert.equal(starts.length, 2);
  const [when, position] = starts[1];
  assert.equal(when, 14.02);
  assert.ok(Math.abs(position - 9) < 1e-9);
  assert.ok(Math.abs(player.currentTime - (position - 0.02)) < 1e-9);
});

test('an original loaded while paused waits for the next play', async () => {
  const { player, starts } = fixture();
  await player.loadTrack(1);
  assert.equal(starts.length, 0);
  await player.play(3);
  assert.deepEqual(starts, [[10.02, 3], [10.02, 3]]);
});
