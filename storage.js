export const STORAGE_KEYS = {
  draftText: 'draftText',
  committedCandidates: 'committedCandidates',
  settings: 'settings',
  history: 'history',
};

export const DEFAULT_SETTINGS = {
  soundEnabled: true,
  volume: 0.3,
  cropGuide: false,
  debug: false,
  showStartupHint: true,
};

function withDefaults(settings) {
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// JSONのパースエラーを防ぐ安全な読み込み関数
function safeParse(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    return val !== null ? JSON.parse(val) : fallback;
  } catch (e) {
    return fallback;
  }
}

export async function loadAll() {
  return {
    draftText: localStorage.getItem(STORAGE_KEYS.draftText) || '',
    committedCandidates: safeParse(STORAGE_KEYS.committedCandidates, []),
    settings: withDefaults(safeParse(STORAGE_KEYS.settings, null)),
    history: safeParse(STORAGE_KEYS.history, []),
  };
}

export async function saveMany(obj) {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      localStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }
}