import { parseLrc, findActiveIndex } from '/static/js/lrc.js';

const params = new URLSearchParams(location.search);
const videoId = params.get('id') || '';
const title = params.get('title') || '';
const artist = params.get('artist') || '';

document.getElementById('playerTitle').textContent = title || 'Unknown Title';
document.getElementById('playerArtist').textContent = artist || '';

const video = document.getElementById('mainVideo');
video.muted = true; // audio_only.mp4 has no audio track; audio handled separately
if (videoId) video.src = `/api/video/${videoId}`;

// ── Lyrics state ──────────────────────────────────────
let lrcLines = [];
let activeIdx = -1;
let selectedLrcId = null;
let offsetSeconds = 0;

const lyricsStage = document.getElementById('lyricsStage');

function renderLyrics() {
  lyricsStage.innerHTML = '';
  if (!lrcLines.length) {
    lyricsStage.innerHTML = '<div class="lyrics-placeholder">無歌詞，請從右側搜尋</div>';
    return;
  }
  lrcLines.forEach((line, i) => {
    const el = document.createElement('div');
    el.className = 'lyric-line';
    el.dataset.idx = i;
    el.textContent = line.text;
    el.addEventListener('click', () => { video.currentTime = line.time - offsetSeconds; });
    lyricsStage.appendChild(el);
  });
}

function syncLyrics(currentTime) {
  const adjusted = currentTime + offsetSeconds;
  const newIdx = findActiveIndex(lrcLines, adjusted);
  if (newIdx === activeIdx) return;
  activeIdx = newIdx;

  lyricsStage.querySelectorAll('.lyric-line').forEach((el, i) => {
    el.classList.remove('active', 'next');
    if (i === activeIdx) el.classList.add('active');
    else if (i === activeIdx + 1) el.classList.add('next');
  });

  if (activeIdx >= 0) {
    const activeEl = lyricsStage.querySelector('.lyric-line.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

video.addEventListener('timeupdate', () => syncLyrics(video.currentTime));

// ── Offset controls ───────────────────────────────────
const offsetValueEl = document.getElementById('offsetValue');
const offsetSavedEl = document.getElementById('offsetSaved');
let saveTimer = null;

function setOffset(val) {
  offsetSeconds = Math.round(val * 100) / 100;
  offsetValueEl.textContent = (offsetSeconds >= 0 ? '+' : '') + offsetSeconds.toFixed(2) + ' s';
  activeIdx = -1;
  syncLyrics(video.currentTime);
  scheduleSave();
}

function scheduleSave() {
  if (!selectedLrcId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveOffset, 800);
}

async function saveOffset() {
  if (!selectedLrcId || !videoId) return;
  try {
    await fetch(`/api/offset/${videoId}/${selectedLrcId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: offsetSeconds }),
    });
    flashSaved();
  } catch (_) {}
}

async function loadOffset(lrcId) {
  try {
    const resp = await fetch(`/api/offset/${videoId}/${lrcId}`);
    const data = await resp.json();
    setOffset(data.offset ?? 0);
  } catch (_) {
    setOffset(0);
  }
}

function flashSaved() {
  offsetSavedEl.classList.add('show');
  setTimeout(() => offsetSavedEl.classList.remove('show'), 1500);
}

document.getElementById('offsetMinus').addEventListener('click', () => setOffset(offsetSeconds - 0.5));
document.getElementById('offsetPlus').addEventListener('click',  () => setOffset(offsetSeconds + 0.5));
document.getElementById('offsetReset').addEventListener('click', () => setOffset(0));

// ── Audio setup ───────────────────────────────────────
// video_only.mp4 has no audio — always muted, audio handled by <audio> elements
const instrAudio = new Audio(`/api/audio/${videoId}/instrumental`);
const origAudio  = new Audio(`/api/audio/${videoId}/original`);
instrAudio.preload = 'auto';
origAudio.preload  = 'none';

let activeAudio = instrAudio;
let masterVolume = 0.8;
instrAudio.volume = masterVolume;
origAudio.volume  = masterVolume;

function setVolume(v) {
  masterVolume = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
  activeAudio.volume = masterVolume;
}

function syncActive() {
  const drift = activeAudio.currentTime - video.currentTime;
  const abs = Math.abs(drift);
  if (abs > 0.3) {
    // Large drift: hard resync
    activeAudio.currentTime = video.currentTime;
    activeAudio.playbackRate = 1.0;
  } else if (abs > 0.05) {
    // Small drift: nudge playback rate to gently converge (~1% change, inaudible)
    activeAudio.playbackRate = drift > 0 ? 0.99 : 1.01;
  } else {
    activeAudio.playbackRate = 1.0;
  }
}

video.addEventListener('play',       () => activeAudio.play());
video.addEventListener('pause',      () => { if (!document.hidden) activeAudio.pause(); });
video.addEventListener('seeked',     () => { activeAudio.currentTime = video.currentTime; });
video.addEventListener('timeupdate', syncActive);

// When the tab comes back into focus, the browser may have paused the muted video
// while audio continued playing — resync video position from audio and resume.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (!activeAudio.paused && video.paused) {
    video.currentTime = activeAudio.currentTime;
    video.play().catch(() => {});
  }
});

// ── Audio toggle ──────────────────────────────────────
const btnInstrumental = document.getElementById('btnInstrumental');
const btnOriginal     = document.getElementById('btnOriginal');

function switchAudio(audio) {
  if (audio === activeAudio) return;
  const wasPlaying = !video.paused;
  activeAudio.pause();
  activeAudio = audio;
  activeAudio.volume = masterVolume;
  activeAudio.currentTime = video.currentTime;
  if (wasPlaying) activeAudio.play();
  btnInstrumental.classList.toggle('active', activeAudio === instrAudio);
  btnOriginal.classList.toggle('active',     activeAudio === origAudio);
}

btnInstrumental.addEventListener('click', () => switchAudio(instrAudio));
btnOriginal.addEventListener('click',     () => switchAudio(origAudio));

// ── Keyboard controls ─────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - 5);
      break;
    case 'ArrowRight':
      e.preventDefault();
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
      break;
    case 'ArrowUp':
      e.preventDefault();
      setVolume(masterVolume + 0.1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      setVolume(masterVolume - 0.1);
      break;
    case '[':
      setOffset(offsetSeconds - 0.1);
      break;
    case ']':
      setOffset(offsetSeconds + 0.1);
      break;
  }
});

// ── Sidebar search ────────────────────────────────────
const searchInput = document.getElementById('lyricsSearchInput');
const searchBtn = document.getElementById('lyricsSearchBtn');
const resultsList = document.getElementById('resultsList');

async function doSearch(q) {
  resultsList.innerHTML = '<div class="no-results">搜尋中…</div>';
  try {
    const resp = await fetch(`/api/lyrics/search?q=${encodeURIComponent(q)}`);
    const data = await resp.json();
    renderResults(Array.isArray(data) ? data : []);
  } catch (e) {
    resultsList.innerHTML = `<div class="no-results">搜尋失敗：${e.message}</div>`;
  }
}

function renderResults(items) {
  if (!items.length) {
    resultsList.innerHTML = '<div class="no-results">找不到歌詞</div>';
    return;
  }
  resultsList.innerHTML = '';
  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'result-item' + (String(item.id) === String(selectedLrcId) ? ' selected' : '');
    const hasSynced = !!item.syncedLyrics;
    el.innerHTML = `
      <div class="result-track">${escHtml(item.trackName || '')}</div>
      <div class="result-artist">${escHtml(item.artistName || '')}</div>
      <span class="result-badge ${hasSynced ? 'badge-synced' : 'badge-plain'}">
        ${hasSynced ? '同步歌詞' : '純文字'}
      </span>
    `;
    el.addEventListener('click', () => selectLyrics(item, el));
    resultsList.appendChild(el);
  });
}

async function selectLyrics(item, clickedEl) {
  selectedLrcId = String(item.id);
  resultsList.querySelectorAll('.result-item').forEach(el => el.classList.remove('selected'));
  if (clickedEl) clickedEl.classList.add('selected');

  let syncedLyrics = item.syncedLyrics ?? null;
  if (!syncedLyrics) {
    try {
      const resp = await fetch(`/api/lyrics/${item.id}`);
      const data = await resp.json();
      syncedLyrics = data.syncedLyrics ?? null;
    } catch (_) {}
  }

  lrcLines = syncedLyrics ? parseLrc(syncedLyrics) : [];
  activeIdx = -1;
  renderLyrics();

  await loadOffset(selectedLrcId);
  syncLyrics(video.currentTime);

  // Persist selection to DB
  saveSelection(item, syncedLyrics);
}

async function saveSelection(item, syncedLyrics) {
  if (!videoId) return;
  try {
    await fetch(`/api/selection/${videoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lrclib_id: String(item.id),
        track_name: item.trackName || '',
        artist_name: item.artistName || '',
        synced_lyrics: syncedLyrics || null,
      }),
    });
  } catch (_) {}
}

// ── Auto-restore last selection ───────────────────────
async function restoreSelection() {
  if (!videoId) return false;
  try {
    const resp = await fetch(`/api/selection/${videoId}`);
    if (resp.status === 204) return false;
    const saved = await resp.json();
    if (!saved?.lrclib_id) return false;

    selectedLrcId = saved.lrclib_id;
    lrcLines = saved.synced_lyrics ? parseLrc(saved.synced_lyrics) : [];
    renderLyrics();
    await loadOffset(selectedLrcId);
    syncLyrics(video.currentTime);

    // Mark the saved result as selected once search results load
    return true;
  } catch (_) {
    return false;
  }
}

searchBtn.addEventListener('click', () => {
  const q = searchInput.value.trim();
  if (q) doSearch(q);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); const q = searchInput.value.trim(); if (q) doSearch(q); }
});

// ── Init ──────────────────────────────────────────────
async function init() {
  renderLyrics();
  const restored = await restoreSelection();

  // Pre-fill search input but do not auto-submit — title is often too long
  const q = artist ? `${artist} ${title}` : title;
  if (q) searchInput.value = q;

  if (!restored) {
    resultsList.innerHTML = '<div class="no-results">輸入關鍵字後按搜尋</div>';
  }
}

init();

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
