import { STORAGE_KEYS } from '../config.js';

const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const DEFAULT_SETTINGS = {
  master: 0.8,
  music: 0.6,
  sfx: 0.85,
  shake: reducedMotion ? 0.4 : 1,
  quality: 'auto',
  reduceFlashes: reducedMotion,
  scanlines: true,
  showFps: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable or corrupted: fall back to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  } catch {
    /* storage unavailable (private mode / sandboxed iframe) */
  }
}
