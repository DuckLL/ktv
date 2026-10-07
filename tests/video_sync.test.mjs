import assert from 'node:assert/strict';
import test from 'node:test';
import { VideoAudioSync } from '../src/ktv/static/js/video_sync.js';

function fixture() {
  const seeks = [];
  const video = { currentTime: 10, duration: 180, playbackRate: 1, paused: false, seeking: false, readyState: 4 };
  const audio = { currentTime: 10, playing: true, seek: time => seeks.push(time) };
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

test('large drift seeks only the video and ignores its resulting seeked event', () => {
  const { video, audio, seeks, sync } = fixture();
  video.currentTime = 8;
  sync.followAudio();
  assert.equal(video.currentTime, audio.currentTime);
  video.seeking = true;
  audio.currentTime += 0.3;
  sync.followAudio();
  assert.equal(video.currentTime, 10);
  video.seeking = false;
  sync.seeked();
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

test('a user seek still changes the shared audio timeline', () => {
  const { video, seeks, sync } = fixture();
  video.currentTime = 35;
  sync.seeked();
  assert.deepEqual(seeks, [35]);
});

test('a user can override an in-flight automatic video correction', () => {
  const { video, seeks, sync } = fixture();
  video.currentTime = 8;
  sync.followAudio();
  video.currentTime = 35;
  sync.seeked();
  assert.deepEqual(seeks, [35]);
});

test('returning to a paused background video follows ongoing audio', () => {
  const { video, audio, seeks, sync } = fixture();
  video.paused = true;
  audio.currentTime = 30;
  sync.followAudio({ force: true });
  assert.equal(video.currentTime, 30);
  sync.seeked();
  assert.deepEqual(seeks, []);
});
