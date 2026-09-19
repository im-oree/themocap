import { create } from 'zustand';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'wms-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemTheme() : choice;
}

function readStoredChoice(): ThemeChoice {
  if (typeof localStorage === 'undefined') return 'system';
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

/** Applies the resolved theme to <html>. Mirrors the inline bootstrap in index.html. */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

interface ThemeState {
  /** The user's explicit preference, including 'system'. */
  theme: ThemeChoice;
  /** What is actually rendered right now. */
  resolved: ResolvedTheme;
  setTheme: (theme: ThemeChoice) => void;
  /** Subscribe to OS changes while in 'system' mode. Returns an unsubscribe fn. */
  init: () => () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStoredChoice(),
  resolved: resolveTheme(readStoredChoice()),
  setTheme: (theme) => {
    const resolved = resolveTheme(theme);
    if (typeof localStorage !== 'undefined') {
      // 'system' is persisted too, so an explicit "follow the OS" choice survives reloads.
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
    applyTheme(resolved);
    set({ theme, resolved });
  },
  init: () => {
    applyTheme(get().resolved);
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      if (get().theme !== 'system') return;
      const resolved = systemTheme();
      applyTheme(resolved);
      set({ resolved });
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  },
}));
