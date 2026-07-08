export const PREFERENCES_STORAGE_KEY = 'ao_preferences';

export const PREFERENCES_EVENT = 'ao:preferences-changed';

export const DEFAULT_PREFERENCES = Object.freeze({

  theme: 'light',

  chatWidget: true,

});



const isObjectLike = (value) => value && typeof value === 'object' && !Array.isArray(value);



export function mergePreferences(raw = {}) {

  const input = isObjectLike(raw) ? raw : {};

  // Tema escuro removido: o app é sempre claro.
  return {

    theme: 'light',

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



export function resolveThemePreference() {

  // Tema escuro removido: sempre claro.
  return 'light';

}



export function applyThemePreference() {

  try {

    if (typeof document !== 'undefined') {

      document.documentElement?.setAttribute('data-theme', 'light');

    }

    localStorage.setItem('theme', 'light');

    localStorage.setItem('theme_preference', 'light');

  } catch {}

  return 'light';

}



export function broadcastPreferences(next, source = 'app') {

  try {

    const detail = { preferences: mergePreferences(next), source };

    window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail }));

  } catch {}

}

