export function hzToMidi(hz) {
  return hz > 0 && Number.isFinite(hz) ? 69 + 12 * Math.log2(hz / 440) : null;
}

export function captureSongTime(audio, endTime, sampleRate, windowSize, delayMs) {
  const captureCenter = endTime - windowSize / (2 * sampleRate);
  return audio.offset + captureCenter - audio.startedAt - delayMs / 1000;
}

export function referenceAt(reference, seconds) {
  if (!reference || !Number.isFinite(seconds) || seconds < 0) return null;
  const index = Math.round(seconds / reference.hop_seconds);
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

export function pitchFeedback(cents) {
  if (Math.abs(cents) <= 50) return { label: '接近原唱', className: 'close' };
  return cents > 0
    ? { label: `偏高 ${cents} 音分`, className: 'off' }
    : { label: `偏低 ${-cents} 音分`, className: 'off' };
}
