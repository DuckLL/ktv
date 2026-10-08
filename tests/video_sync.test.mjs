import assert from 'node:assert/strict';
import test from 'node:test';
import { VideoAudioSync } from '../src/ktv/static/js/video_sync.js';

function fixture() {
  const seeks = [];
  const video = { currentTime: 10, duration: 180, playbackRate: 1, paused: false, seeking: false, readyState: 4 };
  const audio = { currentTime: 10, playing: true, seek: time => { seeks.push(time); audio.currentTime = time; } };
  return { video, audio, seeks, sync: new VideoAudioSync(video, audio) };
}

test('repeated 200 ms video jitter never seeks the audio', () => {
  const { video, audio, seeks, sync } = fixture();
  for (let i = 0; i < 8; i++) {
    audio.currentTime += 0.25;
    video.currentTime = audio.currentTime - 0.2;
    sync.followAudio();
    assert.ok(video.playbackRate > 1 && video.playbackRate <= 1.03);
  }
  assert.deepEqual(seeks, []);
});

test('large drift seeks only the video and ignores its resulting seeking event', () => {
  const { video, audio, seeks, sync } = fixture();
  video.currentTime = 8;
  sync.followAudio();
  assert.equal(video.currentTime, audio.currentTime);
  video.seeking = true;
  audio.currentTime += 0.1;
  sync.seeking();
  sync.followAudio();
  assert.equal(video.currentTime, 10);
  assert.deepEqual(seeks, []);
});

test('buffering does not restart audio or repeatedly seek the video', () => {
  const { video, seeks, sync } = fixture();
  video.readyState = 1;
  video.currentTime = 7;
  sync.followAudio();
  assert.equal(video.currentTime, 7);
  assert.deepEqual(seeks, []);
});

test('a native-controls seek survives the timeupdate browsers fire before seeked', () => {
  const { video, seeks, sync } = fixture();
  video.currentTime = 35;
  video.seeking = true;
  sync.seeking();
  video.seeking = false;
  sync.followAudio();
  assert.equal(video.currentTime, 35);
  assert.deepEqual(seeks, [35]);
});

test('keyboard and lyric seeks move both clocks before the video finishes seeking', () => {
  const { video, seeks, sync } = fixture();
  video.playbackRate = 1.03;
  sync.seek(35);
  assert.equal(sync.currentTime, 35);
  assert.equal(video.currentTime, 35);
  assert.equal(video.playbackRate, 1);
  video.seeking = true;
  sync.seeking();
  video.seeking = false;
  sync.followAudio();
  assert.equal(video.currentTime, 35);
  assert.deepEqual(seeks, [35]);
});

test('paused playback reports the requested video position', () => {
  const { video, audio, sync } = fixture();
  audio.playing = false;
  video.currentTime = 42;
  assert.equal(sync.currentTime, 42);
});

test('a user can override an in-flight automatic video correction', () => {
  const { video, seeks, sync } = fixture();
  video.currentTime = 8;
  sync.followAudio();
  video.currentTime = 35;
  sync.seeking();
  assert.deepEqual(seeks, [35]);
});

test('returning to a paused background video follows ongoing audio', () => {
  const { video, audio, seeks, sync } = fixture();
  video.paused = true;
  audio.currentTime = 30;
  sync.followAudio({ force: true });
  assert.equal(video.currentTime, 30);
  sync.seeking();
  assert.deepEqual(seeks, []);
});

test('a delayed correction event never rewinds audio that kept playing', () => {
  const { video, audio, seeks, sync } = fixture();
  video.currentTime = 8;
  sync.followAudio();
  audio.currentTime += 1.5;
  sync.seeking();
  assert.equal(audio.currentTime, 11.5);
  assert.deepEqual(seeks, []);
});

test('audio completion stops a lagging video at its end without seeking audio', () => {
  const { video, audio, seeks, sync } = fixture();
  audio.currentTime = 179.9;
  audio.playing = false;
  video.currentTime = 178;
  video.playbackRate = 1.03;
  video.pause = () => { video.paused = true; };
  sync.finish();
  assert.equal(video.paused, true);
  assert.equal(video.currentTime, 180);
  assert.equal(video.playbackRate, 1);
  sync.seeking();
  assert.deepEqual(seeks, []);
});

test('completion can pause a background video before its duration metadata arrives', () => {
  const { video, audio, seeks, sync } = fixture();
  audio.currentTime = 180;
  audio.playing = false;
  video.duration = NaN;
  video.pause = () => { video.paused = true; };
  sync.finish();
  assert.equal(video.currentTime, 180);
  assert.equal(video.paused, true);
  sync.seeking();
  assert.deepEqual(seeks, []);
});
