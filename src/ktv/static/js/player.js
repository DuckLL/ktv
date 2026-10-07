import { parseLrc, findActiveIndex, getNavigationTime } from '/static/js/lrc.js';
import { SynchronizedAudioPlayer } from '/static/js/audio_player.js';
import { VideoAudioSync } from '/static/js/video_sync.js';
import {
  calculateMixVolumes,
  formatVolumePercent,
  getMixButtonState,
  normalizeMixAmount,
  volumeToSliderValue,
} from '/static/js/audio_mix.js';

const params = new URLSearchParams(location.search);
const videoId = params.get('id') || '';
const title = params.get('title') || '';
const artist = params.get('artist') || '';

document.getElementById('playerTitle').textContent = title || 'Unknown Title';
document.getElementById('playerArtist').textContent = artist || '';

const video = document.getElementById('mainVideo');
video.muted = true; // The video has no audio track; audio is handled separately.
if (videoId) video.src = `/api/video/${videoId}`;

// ── Lyrics state ──────────────────────────────────────
let lrcLines = [];
let activeIdx = -1;
let selectedLrcId = null;
let offsetSeconds = 0;

const lyricsStage = document.getElementById('lyricsStage');
const previousLine = document.getElementById('previousLine');
const nextLine = document.getElementById('nextLine');
const searchPanel = document.getElementById('lyricsSearchPanel');
const playbackSettings = document.getElementById('playbackSettings');
const offsetSettings = document.getElementById('offsetSettings');
const mobileLayout = window.matchMedia('(max-width: 760px)');

function setPanelDefaults() {
  [searchPanel, playbackSettings, offsetSettings].forEach(panel => { panel.open = !mobileLayout.matches; });
}
setPanelDefaults();
mobileLayout.addEventListener('change', setPanelDefaults);

function updateNavigation() {
  const hasLyrics = lrcLines.length > 0;
  previousLine.textContent = hasLyrics ? '← 上一句' : '← 退 5 秒';
  nextLine.textContent = hasLyrics ? '下一句 →' : '進 5 秒 →';
  previousLine.setAttribute('aria-label', hasLyrics ? '上一句歌詞' : '快退 5 秒');
  nextLine.setAttribute('aria-label', hasLyrics ? '下一句歌詞' : '快進 5 秒');
  document.getElementById('navigationLabel').textContent = hasLyrics ? '歌詞跳轉' : '播放跳轉';
  document.getElementById('keyboardHint').textContent = hasLyrics ? '← → 上／下一句　↑ ↓ 音量' : '← → 前後 5 秒　↑ ↓ 音量';
}

function navigatePlayback(direction) {
  // Use the same clock as the highlighted lyric so jumps never land one line off.
  videoSync.seek(getNavigationTime(lrcLines, videoSync.currentTime, direction, offsetSeconds, video.duration));
}
previousLine.addEventListener('click', () => navigatePlayback(-1));
nextLine.addEventListener('click', () => navigatePlayback(1));

function renderLyrics() {
  updateNavigation();
  lyricsStage.innerHTML = '';
  if (!lrcLines.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'lyrics-placeholder';
    placeholder.textContent = '尚無同步歌詞';
    const button = document.createElement('button');
    button.className = 'lyrics-search-shortcut';
    button.textContent = '搜尋歌詞';
    button.addEventListener('click', () => {
      searchPanel.open = true;
      document.getElementById('lyricsSearchInput').focus();
    });
    placeholder.appendChild(button);
    lyricsStage.appendChild(placeholder);
    return;
  }
  lrcLines.forEach((line, i) => {
    const el = document.createElement('div');
    el.className = 'lyric-line';
    el.dataset.idx = i;
    el.textContent = line.text;
    el.addEventListener('click', () => videoSync.seek(Math.max(0, line.time - offsetSeconds)));
    lyricsStage.appendChild(el);
  });
}

function centerLyricInStage(activeEl) {
  const stageRect = lyricsStage.getBoundingClientRect();
  const lineRect = activeEl.getBoundingClientRect();
  const lineCenter = lineRect.top - stageRect.top + lyricsStage.scrollTop + lineRect.height / 2;
  const top = Math.max(0, lineCenter - lyricsStage.clientHeight / 2);
  lyricsStage.scrollTo({ top, behavior: 'smooth' });
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
    if (activeEl) centerLyricInStage(activeEl);
  }
}

video.addEventListener('timeupdate', () => syncLyrics(videoSync.currentTime));

// ── Offset controls ───────────────────────────────────
const offsetValueEl = document.getElementById('offsetValue');
const offsetSavedEl = document.getElementById('offsetSaved');
let saveTimer = null;

function setOffset(val) {
  offsetSeconds = Math.round(val * 100) / 100;
  offsetValueEl.textContent = (offsetSeconds >= 0 ? '+' : '') + offsetSeconds.toFixed(2) + ' s';
  document.getElementById('offsetSummary').textContent = offsetValueEl.textContent;
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
const audioPlayer = new SynchronizedAudioPlayer([
  `/api/audio/${videoId}/instrumental`,
  `/api/audio/${videoId}/original`,
]);
const videoSync = new VideoAudioSync(video, audioPlayer);
const audioStatus = document.getElementById('audioStatus');
function showAudioError() {
  audioStatus.textContent = '音訊載入失敗，請在首頁重新處理這首歌';
}
function reportLoading(loading, message, errorMessage) {
  audioStatus.textContent = message;
  loading.then(
    () => { if (audioStatus.textContent === message) audioStatus.textContent = ''; },
    () => { audioStatus.textContent = errorMessage; },
  );
}
const accompaniment = audioPlayer.load();
reportLoading(accompaniment, '音訊載入中…', '音訊載入失敗，請在首頁重新處理這首歌');
// Preload the original right behind the accompaniment: guide vocals are ready
// when the slider moves, while playback waits only for the accompaniment.
accompaniment.then(() => reportLoading(audioPlayer.loadTrack(1), '原唱載入中…', '原唱載入失敗，請在首頁重新處理這首歌'), () => {});

// timeupdate fires only about four times a second; follow the audio clock every frame.
function followLyrics() {
  if (audioPlayer.playing) syncLyrics(audioPlayer.currentTime);
  requestAnimationFrame(followLyrics);
}
requestAnimationFrame(followLyrics);
let masterVolume = 0.8;
let mixAmount = 0;
const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');

function setVolume(v) {
  masterVolume = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
  applyMixVolumes();
  updateVolumeDisplay();
}

function updateVolumeDisplay() {
  volumeSlider.value = volumeToSliderValue(masterVolume);
  volumeValue.textContent = formatVolumePercent(masterVolume);
}

function applyMixVolumes() {
  const volumes = calculateMixVolumes(masterVolume, mixAmount);
  audioPlayer.setVolumes([volumes.instrumental, volumes.original]);
  const mixLabel = mixAmount === 0 ? '伴唱' : mixAmount === 1 ? '原唱' : `導唱 ${Math.round(mixAmount * 100)}%`;
  document.getElementById('audioSettingsSummary').textContent = `音量 ${Math.round(masterVolume * 100)}% · ${mixLabel}`;
}

video.addEventListener('play', () => {
  // A background-tab video resume must not restart audio that kept playing.
  if (audioPlayer.playing) {
    videoSync.followAudio({ force: true });
    return;
  }
  audioPlayer.play(() => video.currentTime).then(() => {
    if (video.paused && !document.hidden) audioPlayer.pause();
  }).catch(showAudioError);
});
video.addEventListener('pause', () => {
  if (!document.hidden) {
    audioPlayer.pause();
    videoSync.reset();
  }
});
video.addEventListener('ended', () => { audioPlayer.pause(); videoSync.reset(); });
video.addEventListener('seeking', () => videoSync.seeking());
video.addEventListener('timeupdate', () => {
  if (!document.hidden) videoSync.followAudio();
});

// The shared audio clock keeps running if a background tab pauses muted video.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (audioPlayer.playing && video.paused) {
    videoSync.followAudio({ force: true });
    video.play().catch(() => {});
  } else if (!video.paused) {
    videoSync.followAudio({ force: true });
  }
});

// ── Audio mix controls ────────────────────────────────
const btnInstrumental = document.getElementById('btnInstrumental');
const btnOriginal     = document.getElementById('btnOriginal');
const vocalMixSlider  = document.getElementById('vocalMixSlider');
const vocalMixValue   = document.getElementById('vocalMixValue');

function updateMixButtons() {
  const state = getMixButtonState(mixAmount);
  btnInstrumental.classList.toggle('active', state.instrumental);
  btnOriginal.classList.toggle('active', state.vocal);
}

function setMix(value) {
  mixAmount = normalizeMixAmount(value);
  vocalMixSlider.value = String(Math.round(mixAmount * 100));
  vocalMixValue.textContent = `${Math.round(mixAmount * 100)}%`;
  applyMixVolumes();
  updateMixButtons();
}

btnInstrumental.addEventListener('click', () => setMix(0));
btnOriginal.addEventListener('click',     () => setMix(1));
vocalMixSlider.addEventListener('input', () => setMix(Number(vocalMixSlider.value) / 100));
volumeSlider.addEventListener('input', () => setVolume(Number(volumeSlider.value) / 100));
updateVolumeDisplay();
setMix(0);

// ── Keyboard controls ─────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey || e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      navigatePlayback(-1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      navigatePlayback(1);
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
  document.getElementById('lyricsSelectionSummary').textContent = item.trackName || '已選擇';
  if (mobileLayout.matches && lrcLines.length) searchPanel.open = false;

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
    document.getElementById('lyricsSelectionSummary').textContent = saved.track_name || '已選擇';
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
