import { parseLrc, findActiveIndex, getNavigationTime, rankLyricResults } from '/static/js/lrc.js';
import { SynchronizedAudioPlayer } from '/static/js/audio_player.js';
import { VideoAudioSync } from '/static/js/video_sync.js';
import { PitchFeedback } from '/static/js/pitch_feedback.js';
import { suggestLyricOffset, retimeLyricLine, serializeLrc } from '/static/js/lyric_alignment.js';
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
const youtubeLink = document.getElementById('youtubeLink');
if (videoId) {
  youtubeLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  youtubeLink.hidden = false;
}

const video = document.getElementById('mainVideo');
video.muted = true; // The video has no audio track; audio is handled separately.
if (videoId) video.src = `/api/video/${videoId}`;

// ── Lyrics state ──────────────────────────────────────
let lrcLines = [];
let activeIdx = -1;
let selectedLrcId = null;
let offsetSeconds = 0;
let selectedItem = null;
let selectionRevision = 0;
let selectionSave = Promise.resolve();

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
// Desktop hides the panel headers, so reopen panels there; rotating a phone keeps the user's choice.
mobileLayout.addEventListener('change', () => { if (!mobileLayout.matches) setPanelDefaults(); });

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
    el.textContent = line.text || '♪';
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
const offsetTimers = new Map();
const pendingOffsets = new Map();
let offsetSave = Promise.resolve();

function setOffset(val, save = true) {
  offsetSeconds = Math.round(val * 100) / 100;
  offsetValueEl.textContent = (offsetSeconds >= 0 ? '+' : '') + offsetSeconds.toFixed(2) + ' s';
  document.getElementById('offsetSummary').textContent = offsetValueEl.textContent;
  activeIdx = -1;
  syncLyrics(videoSync.currentTime);
  if (save) scheduleSave();
}

function scheduleSave() {
  if (!selectedLrcId) return;
  const id = selectedLrcId;
  const offset = offsetSeconds;
  clearTimeout(offsetTimers.get(id));
  pendingOffsets.set(id, offset);
  offsetTimers.set(id, setTimeout(() => {
    offsetTimers.delete(id);
    saveOffset(id, offset);
  }, 800));
}

async function saveOffset(id, offset) {
  if (!id || !videoId) return;
  const saving = offsetSave.catch(() => {}).then(() => fetch(`/api/offset/${videoId}/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset }),
  }));
  offsetSave = saving;
  try {
    const response = await saving;
    if (!response.ok) throw new Error('儲存失敗');
    if (pendingOffsets.get(id) === offset) pendingOffsets.delete(id);
    if (String(id) === String(selectedLrcId) && offset === offsetSeconds) flashSaved();
  } catch (_) {
    if (String(id) === String(selectedLrcId)) {
      offsetSavedEl.textContent = '儲存失敗';
      offsetSavedEl.classList.add('show');
    }
  }
}

async function fetchOffset(lrcId) {
  const id = String(lrcId);
  if (pendingOffsets.has(id)) return pendingOffsets.get(id);
  try {
    const resp = await fetch(`/api/offset/${videoId}/${id}`);
    if (!resp.ok) throw new Error('讀取失敗');
    const data = await resp.json();
    return pendingOffsets.get(id) ?? (Number.isFinite(data.offset) ? data.offset : 0);
  } catch (_) {
    return pendingOffsets.get(id) ?? 0;
  }
}

function flashSaved() {
  offsetSavedEl.textContent = '已儲存';
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
const pitchFeedback = new PitchFeedback(audioPlayer, videoId);
const referenceReady = pitchFeedback.loadReference();
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
  if (audioPlayer.playing) {
    if (!document.hidden) videoSync.followAudio();
    syncLyrics(audioPlayer.currentTime);
  }
  requestAnimationFrame(followLyrics);
}
requestAnimationFrame(followLyrics);
let masterVolume = 0.8;
let mixAmount = 0;
const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');
const keySelect = document.getElementById('keySelect');
const keyStatus = document.getElementById('keyStatus');
let keySelectionRevision = 0;

function keyLabel(key) {
  return key === 0 ? '原調' : `${key > 0 ? '+' : '−'}${Math.abs(key)} 半音`;
}

audioPlayer.onkeychange = () => {
  pitchFeedback.updateChartRange();
  pitchFeedback.resetComparison();
  applyMixVolumes();
};

keySelect.addEventListener('change', async () => {
  const revision = ++keySelectionRevision;
  const key = Number(keySelect.value);
  keyStatus.textContent = `正在準備${keyLabel(key)}…首次使用可能需要幾秒鐘。`;
  try {
    await audioPlayer.setKey(key);
    if (revision !== keySelectionRevision) return;
    keyStatus.textContent = '';
  } catch (_) {
    if (revision !== keySelectionRevision) return;
    keyStatus.textContent = `升降 key 失敗，仍使用${keyLabel(audioPlayer.keySemitones)}。請稍後再試。`;
  }
  keySelect.value = String(audioPlayer.keySemitones);
});

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
  document.getElementById('audioSettingsSummary').textContent = `音量 ${Math.round(masterVolume * 100)}% · ${mixLabel} · ${keyLabel(audioPlayer.keySemitones)}`;
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
  if (!document.hidden && !video.ended) {
    audioPlayer.pause();
    videoSync.reset();
  }
});
audioPlayer.onended = () => videoSync.finish();
video.addEventListener('ended', () => {
  // A video that reaches its end slightly ahead must not cut off the audio.
  videoSync.reset();
  if (audioPlayer.playing && audioPlayer.currentTime < video.duration && !document.hidden) {
    videoSync.followAudio({ force: true });
    if (!video.ended) video.play().catch(() => {});
  }
});
video.addEventListener('seeking', () => videoSync.seeking());
video.addEventListener('timeupdate', () => {
  if (!document.hidden) videoSync.followAudio();
});

// The shared audio clock keeps running if a background tab pauses muted video.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (audioPlayer.playing && video.paused) {
    videoSync.followAudio({ force: true });
    if (!video.ended) video.play().catch(() => {});
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
  const revision = ++lyricSearchRevision;
  resultsList.innerHTML = '<div class="no-results">搜尋中…</div>';
  try {
    const resp = await fetch(`/api/lyrics/search?q=${encodeURIComponent(q)}`);
    const data = await resp.json();
    if (revision !== lyricSearchRevision) return;
    if (!resp.ok) throw new Error(data.error || '歌詞搜尋失敗');
    renderResults(Array.isArray(data) ? data : []);
  } catch (e) {
    if (revision !== lyricSearchRevision) return;
    resultsList.replaceChildren();
    const error = document.createElement('div');
    error.className = 'no-results';
    error.textContent = `搜尋失敗：${e.message}`;
    resultsList.appendChild(error);
  }
}

function renderResults(items) {
  if (!items.length) {
    resultsList.innerHTML = '<div class="no-results">找不到歌詞</div>';
    return;
  }
  resultsList.innerHTML = '';
  rankLyricResults(items, video.duration).forEach((item) => {
    const el = document.createElement('div');
    el.className = 'result-item' + (String(item.id) === String(selectedLrcId) ? ' selected' : '');
    const hasSynced = !!item.syncedLyrics;
    el.innerHTML = `
      <div class="result-track">${escHtml(item.trackName || '')}</div>
      <div class="result-artist">${escHtml(item.artistName || '')}${formatDuration(item.duration)}</div>
      <span class="result-badge ${hasSynced ? 'badge-synced' : 'badge-plain'}">
        ${hasSynced ? '同步歌詞' : '純文字'}
      </span>
    `;
    el.addEventListener('click', () => selectLyrics(item, el));
    resultsList.appendChild(el);
  });
}

async function selectLyrics(item, clickedEl) {
  const revision = ++selectionRevision;
  const id = String(item.id);
  const loadingOffset = fetchOffset(id);
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

  const offset = await loadingOffset;
  if (revision !== selectionRevision) return;

  selectedLrcId = id;
  selectedItem = item;
  lrcLines = syncedLyrics ? parseLrc(syncedLyrics) : [];
  activeIdx = -1;
  renderLyrics();
  setOffset(offset, false);
  document.getElementById('lyricsSelectionSummary').textContent = item.trackName || '已選擇';
  if (mobileLayout.matches && lrcLines.length) searchPanel.open = false;

  // Persist selection to DB
  const saved = await saveSelection(item, syncedLyrics);
  if (!saved && revision === selectionRevision) autoStatus.textContent = '歌詞已選用，但儲存失敗，請再選一次重試。';
  return saved;
}

async function saveSelection(item, syncedLyrics) {
  if (!videoId) return;
  const body = JSON.stringify({
    lrclib_id: String(item.id), track_name: item.trackName || '',
    artist_name: item.artistName || '', synced_lyrics: syncedLyrics || null,
  });
  const saving = selectionSave.catch(() => {}).then(() => fetch(`/api/selection/${videoId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  }));
  selectionSave = saving;
  try {
    const response = await saving;
    if (!response.ok) throw new Error('儲存失敗');
    return true;
  } catch (_) { return false; }
}

// ── Auto-restore last selection ───────────────────────
async function restoreSelection() {
  const revision = selectionRevision;
  if (!videoId) return false;
  try {
    const resp = await fetch(`/api/selection/${videoId}`);
    if (resp.status === 204) return false;
    const saved = await resp.json();
    if (revision !== selectionRevision) return null;
    if (!saved?.lrclib_id) return false;

    const offset = await fetchOffset(saved.lrclib_id);
    if (revision !== selectionRevision) return null;

    selectedLrcId = saved.lrclib_id;
    selectedItem = { id: saved.lrclib_id, trackName: saved.track_name, artistName: saved.artist_name };
    lrcLines = saved.synced_lyrics ? parseLrc(saved.synced_lyrics) : [];
    document.getElementById('lyricsSelectionSummary').textContent = saved.track_name || '已選擇';
    renderLyrics();
    setOffset(offset, false);

    // Mark the saved result as selected once search results load
    return true;
  } catch (_) {
    return false;
  }
}

searchBtn.addEventListener('click', () => {
  selectionRevision++;
  autoStatus.textContent = '';
  const q = searchInput.value.trim();
  if (q) doSearch(q);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); selectionRevision++; const q = searchInput.value.trim(); if (q) doSearch(q); }
});

let lyricSearchRevision = 0;
const autoStatus = document.getElementById('lyricsAutoStatus');
const alignmentStatus = document.getElementById('lyricAlignmentStatus');

function songDuration() {
  const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : video.duration;
  return Number.isFinite(duration) ? duration : 0;
}

async function autoFindLyrics() {
  if (!title) return;
  const searchRevision = ++lyricSearchRevision;
  const selection = selectionRevision;
  autoStatus.textContent = '正在依歌名、歌手與長度自動找歌詞…';
  const query = new URLSearchParams({ title, artist, duration: String(songDuration()) });
  try {
    const response = await fetch(`/api/lyrics/auto?${query}`);
    const data = await response.json();
    if (searchRevision !== lyricSearchRevision || selection !== selectionRevision) return;
    if (!response.ok) throw new Error(data.error || '自動找詞失敗');
    searchInput.value = data.query || `${artist} ${title}`.trim();
    renderResults(data.results || []);
    if (data.selected) {
      const chosenRevision = selectionRevision + 1;
      const saved = await selectLyrics(data.selected);
      if (selectionRevision !== chosenRevision) return;
      autoStatus.textContent = saved
        ? `已自動選用：${data.selected.artistName} — ${data.selected.trackName}`
        : '歌詞已選用，但儲存失敗，請重新選用或稍後重試。';
      await alignLyrics(true);
    } else {
      autoStatus.textContent = data.results?.length ? '找到候選歌詞，請確認歌曲版本。' : '尚未找到，請調整關鍵字搜尋。';
      if (!lrcLines.length) searchPanel.open = true;
    }
  } catch (error) {
    if (searchRevision === lyricSearchRevision && selection === selectionRevision) autoStatus.textContent = error.message;
  }
}

async function alignLyrics(automatic = false) {
  const selection = selectionRevision;
  const offset = offsetSeconds;
  const reference = await referenceReady;
  if (selection !== selectionRevision || offset !== offsetSeconds) return;
  const suggestion = suggestLyricOffset(lrcLines, reference, offset);
  if (!suggestion) {
    if (!automatic) alignmentStatus.textContent = '未找到明確的整體時間差；可用此句微調。';
    return;
  }
  setOffset(suggestion.offset);
  alignmentStatus.textContent = `已依 ${suggestion.matched} 句起音校正；請聽看看，可再微調。`;
}

document.getElementById('alignLyrics').addEventListener('click', () => alignLyrics());
document.getElementById('lyricsAutoRetry').addEventListener('click', () => autoFindLyrics());

async function editCurrentLine(delta) {
  if (activeIdx < 0 || !selectedItem || !lrcLines[activeIdx]?.text) {
    alignmentStatus.textContent = '播放到想調整的歌詞後，再校正此句。';
    return;
  }
  const revision = selectionRevision;
  const time = delta === null ? videoSync.currentTime + offsetSeconds : lrcLines[activeIdx].time + delta;
  lrcLines = retimeLyricLine(lrcLines, activeIdx, time);
  activeIdx = -1;
  renderLyrics();
  syncLyrics(videoSync.currentTime);
  const saved = await saveSelection(selectedItem, serializeLrc(lrcLines));
  if (revision !== selectionRevision) return;
  alignmentStatus.textContent = saved ? '已儲存此句時間。' : '此句已調整，但儲存失敗，請再試一次。';
}
document.getElementById('lyricLineEarlier').addEventListener('click', () => editCurrentLine(-0.1));
document.getElementById('lyricLineLater').addEventListener('click', () => editCurrentLine(0.1));
document.getElementById('lyricLineNow').addEventListener('click', () => editCurrentLine(null));

// ── Init ──────────────────────────────────────────────
async function init() {
  renderLyrics();
  const restored = await restoreSelection();
  if (restored === null) return;

  if (!restored) {
    // Wait for metadata without delaying the player's audio or microphone setup.
    if (!Number.isFinite(video.duration) && video.readyState === 0) {
      await Promise.race([new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true })), new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    if (!selectedLrcId && selectionRevision === 0) await autoFindLyrics();
  } else {
    autoStatus.textContent = '已還原上次選用的歌詞與校正時間。';
  }
}

init();

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  return ` · ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
