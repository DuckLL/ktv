export function hzToMidi(hz) {
  return hz > 0 && Number.isFinite(hz) ? 69 + 12 * Math.log2(hz / 440) : null;
}

export function midiToNote(midi) {
  if (!Number.isFinite(midi)) return '—';
  const rounded = Math.round(midi);
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

export function transposeMidi(midi, semitones) {
  return Number.isFinite(midi) ? midi + semitones : null;
}

export function pitchChartRange(midiValues) {
  const voiced = midiValues.filter(Number.isFinite).sort((a, b) => a - b);
  if (!voiced.length) return { min: 57, max: 81 };
  // Rare tracking errors should not shrink every note in a full-song chart.
  const low = voiced[Math.floor((voiced.length - 1) * 0.01)];
  const high = voiced[Math.ceil((voiced.length - 1) * 0.99)];
  const center = (low + high) / 2;
  const halfSpan = Math.max(12, Math.min(18, (high - low) / 2 + 4));
  return { min: Math.floor(center - halfSpan), max: Math.ceil(center + halfSpan) };
}

export function captureSongTime(audio, endTime, sampleRate, windowSize, delayMs) {
  const captureCenter = endTime - windowSize / (2 * sampleRate);
  const outputDelay = Math.max(0, Number(audio.context?.baseLatency || 0)) + Math.max(0, Number(audio.context?.outputLatency || 0));
  return audio.offset + captureCenter - audio.startedAt - outputDelay - delayMs / 1000;
}

export function referenceAt(reference, seconds) {
  if (!reference || !Number.isFinite(seconds) || seconds < 0) return null;
  const index = Math.round(seconds / reference.hop_seconds);
  if (!Number.isFinite(reference.midi[index])) return null;
  const values = [];
  for (let i = Math.max(0, index - 3); i <= Math.min(reference.midi.length - 1, index + 3); i++) {
    const value = reference.midi[i];
    if (Number.isFinite(value)) values.push(value);
  }
  if (values.length < 3) return null;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

export function pitchDifferenceCents(sungMidi, referenceMidi) {
  return Math.round((sungMidi - referenceMidi) * 100);
}

export function pitchFeedback(cents, tolerance = 50) {
  if (Math.abs(cents) <= tolerance) return { label: '接近目標', className: 'close' };
  return cents > 0
    ? { label: `偏高 ${cents} 音分`, className: 'off' }
    : { label: `偏低 ${-cents} 音分`, className: 'off' };
}

export const PRACTICE_MODES = {
  practice: { cents: 80, seconds: 0.12 },
  relaxed: { cents: 100, seconds: 0.18 },
  strict: { cents: 50, seconds: 0.05 },
};

export const MIC_SENSITIVITY = {
  normal: { rms: 0.004, clarity: 0.76 },
  quiet: { rms: 0.0018, clarity: 0.72 },
  noisy: { rms: 0.012, clarity: 0.85 },
};

/** Timing grace applies around a voiced target, never across a rest or octave. */
export function matchReference(reference, seconds, sungMidi, semitones, timingGrace) {
  const center = referenceAt(reference, seconds);
  if (center === null || !Number.isFinite(sungMidi)) return null;
  let best = center + semitones;
  const first = Math.max(0, Math.floor((seconds - timingGrace) / reference.hop_seconds));
  const last = Math.min(reference.midi.length - 1, Math.ceil((seconds + timingGrace) / reference.hop_seconds));
  const at = Math.round(seconds / reference.hop_seconds);
  for (const direction of [-1, 1]) {
    for (let i = at; i >= first && i <= last; i += direction) {
      const value = reference.midi[i];
      if (!Number.isFinite(value)) break;
      const target = value + semitones;
      if (Math.abs(sungMidi - target) < Math.abs(sungMidi - best)) best = target;
    }
  }
  return best;
}

/** Reject transient jumps using the singer's history, independently of the target. */
export class LivePitchTracker {
  constructor() { this.reset(); }

  reset() {
    this.last = null;
    this.time = -Infinity;
    this.pending = null;
    this.recent = [];
  }

  update(midi, time) {
    if (!Number.isFinite(midi)) {
      if (time - this.time > 0.16) this.reset();
      return null;
    }
    if (time - this.time > 0.18) this.reset();
    if (this.last !== null && Math.abs(midi - this.last) >= 7) {
      if (!this.pending || Math.abs(midi - this.pending.midi) > 1.5) this.pending = { midi, time };
      if (time - this.pending.time < 0.085) return null;
      this.recent = [];
    } else {
      this.pending = null;
    }
    if (this.last !== null && Math.abs(midi - this.last) > 1.8) this.recent = [];
    this.recent.push(midi);
    if (this.recent.length > 3) this.recent.shift();
    const sorted = [...this.recent].sort((a, b) => a - b);
    const stable = sorted[Math.floor(sorted.length / 2)];
    this.last = 0.65 * midi + 0.35 * stable;
    this.time = time;
    return this.last;
  }
}
