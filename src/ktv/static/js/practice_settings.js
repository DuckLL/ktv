const KEY = 'ktv-practice-settings';

export function loadPracticeSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) { return {}; }
}

export function savePracticeSettings(changes) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...loadPracticeSettings(), ...changes })); } catch (_) {}
}
