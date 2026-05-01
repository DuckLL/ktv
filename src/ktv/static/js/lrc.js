/**
 * Parse LRC format lyrics into [{time, text}] sorted by time.
 * [mm:ss.xx]Line text
 */
export function parseLrc(raw) {
  if (!raw) return [];
  const lines = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (!m) continue;
    const time = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / (m[3].length === 3 ? 1000 : 100);
    const text = m[4].trim();
    if (text) lines.push({ time, text });
  }
  return lines.sort((a, b) => a.time - b.time);
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
