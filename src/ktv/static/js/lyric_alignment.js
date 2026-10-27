/** Conservative LRC correction using vocal starts, without guessing lyric text. */
export function vocalOnsets(reference) {
  if (!reference?.midi?.length || !(reference.hop_seconds > 0)) return [];
  const hop = reference.hop_seconds;
  const onsets = [];
  let start = null, lastEnd = -Infinity;
  for (let i = 0; i <= reference.midi.length; i++) {
    if (Number.isFinite(reference.midi[i])) {
      if (start === null) start = i;
    } else if (start !== null) {
      if ((i - start) * hop >= 0.12 && (start - lastEnd) * hop >= 0.16) onsets.push(start * hop);
      lastEnd = i;
      start = null;
    }
  }
  return onsets;
}

export function suggestLyricOffset(lines, reference, offset = 0) {
  const onsets = vocalOnsets(reference);
  const starts = [...new Set(lines.filter(line => line.text?.trim()).map(line => line.time - offset))];
  if (starts.length < 4 || onsets.length < 4) return null;
  const distance = time => {
    let lo = 0, hi = onsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (onsets[mid] < time) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(Math.abs((onsets[lo] ?? Infinity) - time), Math.abs((onsets[lo - 1] ?? -Infinity) - time));
  };
  const measure = shift => {
    const distances = starts.map(time => distance(time + shift));
    return {
      shift,
      score: distances.reduce((sum, value) => sum + Math.max(0, 1 - value / 0.35), 0) / starts.length - Math.abs(shift) * 0.025,
      matched: distances.filter(value => value <= 0.18).length,
    };
  };
  const baseline = measure(0);
  let best = baseline;
  for (let i = -75; i <= 75; i++) {
    const candidate = measure(i * 0.02);
    if (candidate.score > best.score) best = candidate;
  }
  if (best.matched < Math.max(4, starts.length * 0.4) || best.score - baseline.score < 0.12 || Math.abs(best.shift) < 0.06) return null;
  // Competing distant peaks usually indicate repetitive phrasing, not a reliable offset.
  for (let i = -75; i <= 75; i++) {
    const shift = i * 0.02;
    if (Math.abs(shift - best.shift) > 0.3 && measure(shift).score > best.score - 0.04) return null;
  }
  return { offset: Math.round((offset - best.shift) * 100) / 100, matched: best.matched, total: starts.length };
}
