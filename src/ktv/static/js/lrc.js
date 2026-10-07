const TIMESTAMP = String.raw`(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?`;
const LINE_STAMPS = new RegExp(String.raw`^\s*(?:\[${TIMESTAMP}\])+`);
const STAMP = new RegExp(TIMESTAMP, 'g');
const WORD_STAMP = new RegExp(`<${TIMESTAMP}>`, 'g');

/**
 * Parse LRC format lyrics into [{time, text}] sorted by time.
 * [mm:ss.xx]Line text, [mm:ss.xx][mm:ss.xx]Repeated line. An empty text marks
 * an instrumental break; enhanced-LRC word timings (<mm:ss.xx>) are dropped.
 */
export function parseLrc(raw) {
  if (!raw) return [];
  const lines = [];
  for (const line of raw.split('\n')) {
    const stamps = line.match(LINE_STAMPS);
    if (!stamps) continue;
    const text = line.slice(stamps[0].length).replace(WORD_STAMP, '').trim();
    for (const [, min, sec, frac = ''] of stamps[0].matchAll(STAMP)) {
      lines.push({ time: Number(min) * 60 + Number(sec) + (frac ? Number(frac) / 10 ** frac.length : 0), text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

export function isInstrumentalBreak(line) {
  return line.text === '';
}

/**
 * Binary search: find the index of the active lyric line for a given time.
 * Returns -1 if before first line.
 */
export function findActiveIndex(lines, currentTime) {
  if (!lines.length) return -1;
  let lo = 0, hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].time <= currentTime) lo = mid;
    else hi = mid - 1;
  }
  return lines[lo].time <= currentTime ? lo : -1;
}

/** Navigate distinct lyric timestamps, falling back to five seconds without LRC. */
export function getNavigationTime(lines, currentTime, direction, offset = 0, duration = Infinity) {
  const clamp = time => Math.max(0, Math.min(Number.isFinite(duration) ? duration : Infinity, time));
  if (!lines.length) return clamp(currentTime + direction * 5);
  const adjusted = currentTime + offset;
  const active = findActiveIndex(lines, adjusted + 0.01);
  // Jumps land on sung lines; during a break, previous returns to the line just sung.
  if (direction > 0) {
    const next = lines.find(line => !isInstrumentalBreak(line) && line.time > adjusted + 0.01);
    return clamp(next ? next.time - offset : currentTime);
  }
  if (active < 0) return 0;
  let previous = active - 1;
  while (previous >= 0 && (lines[previous].time === lines[active].time || isInstrumentalBreak(lines[previous]))) previous--;
  return clamp(lines[Math.max(0, previous)].time - offset);
}

/** Synced lyrics first, then the versions whose length is closest to the video. */
export function rankLyricResults(items, duration) {
  const distance = item => (Number.isFinite(duration) && Number.isFinite(item.duration)
    ? Math.abs(item.duration - duration) : Number.MAX_VALUE);
  return [...items].sort((a, b) => Boolean(b.syncedLyrics) - Boolean(a.syncedLyrics) || distance(a) - distance(b));
}
