export const PREFERENCES_STORAGE_KEY = 'ao_preferences';
export const PREFERENCES_EVENT = 'ao:preferences-changed';
export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'light',
  chatWidget: true,
});

const isObjectLike = (value) => value && typeof value === 'object' && !Array.isArray(value);

export function mergePreferences(raw = {}) {
  const input = isObjectLike(raw) ? raw : {};
  const theme = ['dark', 'light', 'auto'].includes(input.theme) ? input.theme : DEFAULT_PREFERENCES.theme;
  return {
    theme,
    chatWidget: input.chatWidget !== false,
  };
}

export function readPreferences() {
  try {
    const stored = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_PREFERENCES };
    return mergePreferences(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function writePreferences(next) {
  const merged = mergePreferences(next);
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(merged));
  } catch {}
  return merged;
}

export function resolveThemePreference(pref) {
  if (pref === 'dark' || pref === 'light') return pref;
  if (pref === 'auto' || !pref) {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch {}
    return 'light';
  }
  return DEFAULT_PREFERENCES.theme;
}

export function applyThemePreference(pref) {
  const resolved = resolveThemePreference(pref);
  try {
    if (typeof document !== 'undefined') {
      document.documentElement?.setAttribute('data-theme', resolved);
    }
    localStorage.setItem('theme', resolved);
    localStorage.setItem('theme_preference', pref || DEFAULT_PREFERENCES.theme);
  } catch {}
  return resolved;
}

export function broadcastPreferences(next, source = 'app') {
  try {
    const detail = { preferences: mergePreferences(next), source };
    window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail }));
  } catch {}
}
