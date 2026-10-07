export function normalizeMixAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(Math.max(0, Math.min(1, numeric)) * 100) / 100;
}

export function formatVolumePercent(value) {
  return `${Math.round(normalizeMixAmount(value) * 100)}%`;
}

export function volumeToSliderValue(value) {
  return String(Math.round(normalizeMixAmount(value) * 100));
}

export function calculateMixVolumes(masterVolume, mixAmount) {
  const volume = normalizeMixAmount(masterVolume);
  const mix = normalizeMixAmount(mixAmount);
  // The original already contains accompaniment. Complementary gains keep
  // its music near the existing level while retaining the gentle guide curve.
  const originalGain = mix * mix;
  return {
    instrumental: volume * (1 - originalGain),
    original: volume * originalGain,
  };
}

export function getMixButtonState(mixAmount) {
  const mix = normalizeMixAmount(mixAmount);
  return {
    instrumental: mix === 0,
    vocal: mix === 1,
  };
}
