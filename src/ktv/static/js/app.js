import { getLibraryCardState, isPendingVideo } from './library_state.js';

const form = document.getElementById('urlForm');
const urlInput = document.getElementById('urlInput');
const submitBtn = document.getElementById('submitBtn');
const progressWrap = document.getElementById('progressWrap');
const progressLabel = document.getElementById('progressLabel');
const progressFill = document.getElementById('progressFill');

const libraryWrap = document.getElementById('libraryWrap');
const libraryGrid = document.getElementById('libraryGrid');
const librarySearch = document.getElementById('librarySearch');

const STAGE_LABELS = {
  downloading: '下載影片中…',
  separating: '分離人聲中（CPU 模式，請耐心等候）…',
  muxing: '合成影片中…',
  done: '完成，可以播放',
  error: '發生錯誤',
};

// ── Library ───────────────────────────────────────────
let allLibrary = [];
let libraryPollTimer = null;

async function loadLibrary() {
  try {
    const resp = await fetch('/api/library');
    allLibrary = await resp.json();
    if (allLibrary.length) {
      libraryWrap.style.display = 'block';
      renderLibrary(allLibrary);
    }
    syncLibraryPolling(allLibrary.some(isPendingVideo));
  } catch (_) {}
}

function renderLibrary(items) {
  libraryGrid.innerHTML = '';
  if (!items.length) {
    libraryGrid.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;padding:0.5rem">找不到符合的影片</div>';
    return;
  }
  items.forEach((item) => {
    const state = getLibraryCardState(item);
    const card = document.createElement('div');
    card.className = `library-card${state.pending ? ' is-pending' : ''}`;
    card.innerHTML = `
      <div class="library-card-title">${escHtml(item.title || item.video_id)}</div>
      <div class="library-card-meta">
        <div class="library-card-artist">${escHtml(item.artist || '未知歌手')}</div>
        ${state.statusLabel ? `<div class="library-card-status">${escHtml(state.statusLabel)}</div>` : ''}
      </div>
    `;
    card.addEventListener('click', () => handleLibraryCardClick(item));
    libraryGrid.appendChild(card);
  });
}

async function handleLibraryCardClick(item) {
  const state = getLibraryCardState(item);
  if (!state.pending) {
    goToPlayer(item);
    return;
  }

  progressWrap.style.display = 'block';
  setProgress(0, '這首還在背景處理中，可以先播放其他歌。');

  try {
    const resp = await fetch(`/api/status/${encodeURIComponent(item.video_id)}`);
    if (!resp.ok) return;

    const status = await resp.json();
    if (status.status === 'done') {
      await loadLibrary();
      goToPlayer(status);
      return;
    }
    setProgress(status.pct ?? 0, status.msg || '這首還在背景處理中，可以先播放其他歌。');
  } catch (_) {}
}

function goToPlayer(item) {
  const p = new URLSearchParams({ id: item.video_id, title: item.title || '', artist: item.artist || '' });
  window.location.href = `/player?${p}`;
}

function syncLibraryPolling(shouldPoll) {
  if (shouldPoll && !libraryPollTimer) {
    libraryPollTimer = setInterval(loadLibrary, 5000);
    return;
  }
  if (!shouldPoll && libraryPollTimer) {
    clearInterval(libraryPollTimer);
    libraryPollTimer = null;
  }
}

librarySearch.addEventListener('input', () => {
  const q = librarySearch.value.trim().toLowerCase();
  if (!q) { renderLibrary(allLibrary); return; }
  const filtered = allLibrary.filter(
    (item) =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.artist || '').toLowerCase().includes(q)
  );
  renderLibrary(filtered);
});

// ── URL submit ────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  submitBtn.disabled = true;
  progressWrap.style.display = 'block';
  setProgress(5, '送入背景處理…');

  try {
    const resp = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'API error');
    }

    const evt = await resp.json();
    handleEvent(evt);
    urlInput.value = '';
    submitBtn.disabled = false;
    await loadLibrary();
  } catch (err) {
    setProgress(0, `錯誤：${err.message}`);
    submitBtn.disabled = false;
  }
});

function handleEvent(evt) {
  if (evt.stage === 'done') {
    setProgress(100, STAGE_LABELS.done);
    return;
  }
  if (evt.status === 'done') {
    setProgress(100, '這首已經處理完成，可以播放。');
    return;
  }
  if (evt.status === 'queued' || evt.status === 'processing') {
    setProgress(evt.pct ?? 10, '已送入背景處理，可以先點其他歌。');
    return;
  }
  if (evt.stage === 'error') {
    setProgress(0, `錯誤：${evt.msg}`);
    submitBtn.disabled = false;
    return;
  }
  setProgress(evt.pct ?? 0, evt.msg || STAGE_LABELS[evt.stage] || evt.stage);
}

function setProgress(pct, label) {
  progressFill.style.width = `${pct}%`;
  progressLabel.textContent = label;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Init ──────────────────────────────────────────────
loadLibrary();
