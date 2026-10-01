/**
 * Makes the app's first paint follow the Claude viewer's theme.
 *
 * The app only knows one rule: dark unless localStorage "theme" is "light", and it writes
 * that key when the user toggles with `d → m`. To follow the viewer without changing the
 * app, the viewer's theme is written to that key before the app mounts, with a marker
 * recording that the value was automatic. A stored value that no longer matches the marker
 * is one the user toggled, and it wins from then on.
 */
export type ThemeName = "dark" | "light";

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const THEME_KEY = "theme";
const AUTO_KEY = "theme:auto";

/** `explicit` is the viewer's `data-theme` attribute; unset means "follow the system". */
export function viewerTheme(explicit: string | null, prefersDark: boolean): ThemeName {
  if (explicit === "dark" || explicit === "light") return explicit;
  return prefersDark ? "dark" : "light";
}

export function reconcileStoredTheme(storage: ThemeStorage, viewer: ThemeName): ThemeName {
  const stored = storage.getItem(THEME_KEY);
  if (stored !== null && stored !== storage.getItem(AUTO_KEY)) {
    storage.removeItem(AUTO_KEY);
    return stored === "light" ? "light" : "dark";
  }
  storage.setItem(THEME_KEY, viewer);
  storage.setItem(AUTO_KEY, viewer);
  return viewer;
}

export function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => { items.delete(key); },
    setItem: (key, value) => { items.set(key, String(value)); },
  };
}

/**
 * Browser storage can throw inside an artifact (a private window, blocked site data, a
 * thumbnail capture), and the app reads it unguarded. When it does, swap in an in-memory
 * stand-in so the app still runs; it just forgets its preferences on reload.
 */
export function ensureStorage(win: Window): void {
  try {
    const probe = "notedude:probe";
    win.localStorage.setItem(probe, "1");
    win.localStorage.removeItem(probe);
  } catch {
    Object.defineProperty(win, "localStorage", { value: memoryStorage(), configurable: true });
  }
}
