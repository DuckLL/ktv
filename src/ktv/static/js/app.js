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
const searchResults = document.getElementById('songSearchResults');
const songSearchStatus = document.getElementById('songSearchStatus');
const songSearchList = document.getElementById('songSearchList');
let searchRequest = null;

function isLink(text) { return /^(?:https?:\/\/|(?:www\.)?(?:youtube\.com|youtu\.be)\/)/i.test(text); }

urlInput.addEventListener('input', () => {
  submitBtn.textContent = isLink(urlInput.value.trim()) ? '開始處理' : '搜尋';
});

async function findSongs(query) {
  searchRequest?.abort();
  const request = new AbortController();
  searchRequest = request;
  searchResults.hidden = false;
  songSearchList.replaceChildren();
  songSearchStatus.textContent = '正在搜尋 YouTube…';
  try {
    const response = await fetch(`/api/songs/search?q=${encodeURIComponent(query)}`, { signal: request.signal });
    const songs = await response.json();
    if (request !== searchRequest) return;
    if (!response.ok) throw new Error(songs.error || '搜尋失敗');
    songSearchStatus.textContent = songs.length ? '選擇想練唱的版本' : '找不到歌曲，試試歌名加歌手。';
    for (const song of songs) {
      const row = document.createElement('article');
      row.className = 'song-search-item';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = song.title;
      const meta = document.createElement('p');
      const duration = Number.isFinite(song.duration) ? ` · ${Math.floor(song.duration / 60)}:${String(Math.floor(song.duration % 60)).padStart(2, '0')}` : '';
      meta.textContent = `${song.artist}${duration}`;
      copy.append(title, meta);
      const button = document.createElement('button');
      button.className = 'song-add-button';
      const existing = allLibrary.find(item => item.video_id === song.video_id);
      button.textContent = existing && !isPendingVideo(existing) && !existing.error ? '開始練唱' : '加入練唱';
      button.addEventListener('click', async () => {
        if (existing && !isPendingVideo(existing) && !existing.error) { goToPlayer(existing); return; }
        button.disabled = true;
        const success = await submitUrl(`https://www.youtube.com/watch?v=${song.video_id}`);
        button.textContent = success ? '已加入歌曲庫' : '重試';
        button.disabled = success;
      });
      row.append(copy, button);
      songSearchList.appendChild(row);
    }
  } catch (error) {
    if (error.name !== 'AbortError') songSearchStatus.textContent = error.message || '搜尋暫時無法使用，仍可貼上網址。';
  }
}

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
    card.className = `library-card${state.pending ? ' is-pending' : ''}${state.failed ? ' is-failed' : ''}`;
    if (state.failed) card.title = item.error;
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
  if (state.failed) {
    await submitUrl(`https://www.youtube.com/watch?v=${item.video_id}`);
    return;
  }
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
    if (status.status === 'error') {
      setProgress(0, `錯誤：${status.msg}`);
      await loadLibrary();
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
  if (!isLink(url)) { await findSongs(url); return; }
  searchRequest?.abort();
  searchResults.hidden = true;
  if (await submitUrl(url)) {
    urlInput.value = '';
    submitBtn.textContent = '搜尋';
  }
});

async function submitUrl(url) {
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
    if (evt.status === 'done') setProgress(100, '這首已經處理完成，可以播放。');
    else setProgress(evt.pct ?? 10, '已送入背景處理，可以先點其他歌。');
    submitBtn.disabled = false;
    await loadLibrary();
    return true;
  } catch (err) {
    setProgress(0, `錯誤：${err.message}`);
    submitBtn.disabled = false;
    return false;
  }
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
