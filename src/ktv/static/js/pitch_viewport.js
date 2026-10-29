// Display coordinates only: detection, matching and grading keep their own data.
export function currentPitchPoint(history, time) {
  const point = history.at(-1);
  if (!point || !Number.isFinite(point.midi)) return null;
  // Capture time includes the user's latency correction. Freshness uses arrival
  // time so a calibrated microphone still gets a current marker and view.
  const age = time - (point.receivedAt ?? point.time);
  return age >= -0.1 && age <= 0.25 ? point : null;
}

export function localPitchBounds(reference, time, semitones = 0, history = []) {
  const first = Math.max(0, Math.floor((time - 2) / reference.hop_seconds));
  const last = Math.min(reference.midi.length - 1, Math.ceil((time + 4) / reference.hop_seconds));
  const pitches = [];
  for (let i = first; i <= last; i++) {
    if (Number.isFinite(reference.midi[i])) pitches.push(reference.midi[i] + semitones);
  }
  pitches.sort((a, b) => a - b);
  // A few bad reference frames must not zoom the whole chart out.
  let min = pitches.length ? pitches[Math.floor((pitches.length - 1) * 0.01)] : Infinity;
  let max = pitches.length ? pitches[Math.ceil((pitches.length - 1) * 0.99)] : -Infinity;
  const latest = currentPitchPoint(history, time);
  const recent = latest ? history.filter(point => point.time >= latest.time - 0.45 && point.time <= latest.time && Number.isFinite(point.midi)) : [];
  if (recent.length >= 3) {
    const sung = recent.map(point => point.midi).sort((a, b) => a - b);
    const middle = sung[Math.floor(sung.length / 2)];
    min = Math.min(min, middle);
    max = Math.max(max, middle);
  }
  return Number.isFinite(min) ? { min, max } : null;
}

function desiredRange(bounds) {
  // One octave or less for a simple phrase; more room for real wide melodies.
  const span = Math.max(10, Math.ceil((bounds.max - bounds.min + 4) / 2) * 2);
  return { center: Math.round((bounds.min + bounds.max) / 2), span };
}

function approach(value, goal, seconds, tau, speed) {
  const change = (goal - value) * -Math.expm1(-seconds / tau);
  return value + Math.max(-speed * seconds, Math.min(speed * seconds, change));
}

export class PitchViewport {
  constructor() { this.reset(); }

  reset() {
    this.center = null;
    this.span = null;
    this.goal = null;
    this.frameTime = null;
    this.songTime = null;
    this.shrinkSince = null;
  }

  update(bounds, songTime, frameTime, fallback = { min: 57, max: 81 }) {
    const elapsed = this.frameTime === null ? 0 : Math.max(0, frameTime - this.frameTime);
    const seek = this.songTime !== null && (songTime < this.songTime - 0.05 || songTime - this.songTime > elapsed + 0.4);
    if (this.center === null || seek || elapsed > 1) {
      this.goal = bounds ? desiredRange(bounds) : { center: (fallback.min + fallback.max) / 2, span: fallback.max - fallback.min };
      this.center = this.goal.center;
      this.span = this.goal.span;
      this.shrinkSince = null;
    } else if (bounds) {
      const wanted = desiredRange(bounds);
      if (wanted.span > this.goal.span) {
        this.goal.span = wanted.span;
        this.shrinkSince = null;
      } else if (wanted.span <= this.goal.span - 2) {
        this.shrinkSince ??= frameTime;
        // Zoom back in only after the phrase has stayed narrower for a while.
        if (frameTime - this.shrinkSince >= 1.6) this.goal.span = wanted.span;
      } else {
        this.shrinkSince = null;
      }
      const half = this.goal.span / 2 - 1.25;
      // Keep the axis still while notes remain inside its comfortable area.
      if (bounds.min < this.goal.center - half || bounds.max > this.goal.center + half) {
        this.goal.center = wanted.center;
      }
    }
    const dt = Math.min(0.1, elapsed);
    this.center = approach(this.center, this.goal.center, dt, 0.55, 6);
    this.span = approach(this.span, this.goal.span, dt, this.goal.span > this.span ? 0.35 : 1.2, 12);
    this.frameTime = frameTime;
    this.songTime = songTime;
    return { min: this.center - this.span / 2, max: this.center + this.span / 2 };
  }
}
