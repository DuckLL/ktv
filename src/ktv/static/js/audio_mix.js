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
  const vocalGain = mix * mix;
  return {
    instrumental: volume,
    vocal: Math.round(volume * vocalGain * 100) / 100,
  };
}

export function getMixButtonState(mixAmount) {
  const mix = normalizeMixAmount(mixAmount);
  return {
    instrumental: mix === 0,
    vocal: mix === 1,
  };
}
