import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLibraryCardState,
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
    playable: false,
    statusLabel: '處理中',
  });
});

test('getLibraryCardState marks processed videos as playable', () => {
  assert.deepEqual(getLibraryCardState({ processed_at: 123 }), {
    pending: false,
    playable: true,
    statusLabel: '',
  });
});
