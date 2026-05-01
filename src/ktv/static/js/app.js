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
  done: '完成！正在跳轉…',
  error: '發生錯誤',
};

// ── Library ───────────────────────────────────────────
let allLibrary = [];

async function loadLibrary() {
  try {
    const resp = await fetch('/api/library');
    allLibrary = await resp.json();
    if (allLibrary.length) {
      libraryWrap.style.display = 'block';
      renderLibrary(allLibrary);
    }
  } catch (_) {}
}

function renderLibrary(items) {
  libraryGrid.innerHTML = '';
  if (!items.length) {
    libraryGrid.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;padding:0.5rem">找不到符合的影片</div>';
    return;
  }
  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'library-card';
    card.innerHTML = `
      <div class="library-card-title">${escHtml(item.title || item.video_id)}</div>
      <div class="library-card-artist">${escHtml(item.artist || '未知歌手')}</div>
    `;
    card.addEventListener('click', () => {
      const p = new URLSearchParams({ id: item.video_id, title: item.title || '', artist: item.artist || '' });
      window.location.href = `/player?${p}`;
    });
    libraryGrid.appendChild(card);
  });
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
  setProgress(0, '開始處理…');

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

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        try { handleEvent(JSON.parse(json)); } catch (_) {}
      }
    }
  } catch (err) {
    setProgress(0, `錯誤：${err.message}`);
    submitBtn.disabled = false;
  }
});

function handleEvent(evt) {
  if (evt.stage === 'done') {
    setProgress(100, STAGE_LABELS.done);
    const p = new URLSearchParams({ id: evt.video_id, title: evt.title || '', artist: evt.artist || '' });
    setTimeout(() => { window.location.href = `/player?${p}`; }, 600);
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
