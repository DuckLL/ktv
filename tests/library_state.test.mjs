import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLibraryCardState,
  isFailedVideo,
  isPendingVideo,
} from '../src/ktv/static/js/library_state.js';

test('isPendingVideo treats processed_at 0 as a background import', () => {
  assert.equal(isPendingVideo({ processed_at: 0 }), true);
  assert.equal(isPendingVideo({ processed_at: 123 }), false);
  assert.equal(isPendingVideo({}), false);
});

test('getLibraryCardState marks pending videos as not playable', () => {
  assert.deepEqual(getLibraryCardState({ processed_at: 0 }), {
    pending: true,
    failed: false,
    playable: false,
    statusLabel: '處理中',
  });
});

test('getLibraryCardState marks processed videos as playable', () => {
  assert.deepEqual(getLibraryCardState({ processed_at: 123 }), {
    pending: false,
    failed: false,
    playable: true,
    statusLabel: '',
  });
});

test('failed videos offer a retry instead of polling as pending', () => {
  const item = { processed_at: 0, error: 'HTTP Error 403' };
  assert.equal(isPendingVideo(item), false);
  assert.equal(isFailedVideo(item), true);
  assert.deepEqual(getLibraryCardState(item), {
    pending: false,
    failed: true,
    playable: false,
    statusLabel: '失敗・點擊重試',
  });
});
