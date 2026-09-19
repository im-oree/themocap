import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, applyTheme, resolveTheme, useThemeStore } from '@wms/ui';

function mockSystemPrefersDark(dark: boolean, listeners: Array<() => void> = []) {
  window.matchMedia = ((query: string) => ({
    matches: dark,
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  delete document.documentElement.dataset.theme;
  mockSystemPrefersDark(false);
});

describe('theme store', () => {
  it('applies the dark class and colour scheme to <html>', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('resolves "system" against the OS preference', () => {
    mockSystemPrefersDark(true);
    expect(resolveTheme('system')).toBe('dark');
    mockSystemPrefersDark(false);
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('persists an explicit choice and toggles instantly', () => {
    useThemeStore.getState().setTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(useThemeStore.getState().resolved).toBe('dark');

    useThemeStore.getState().setTheme('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('follows OS changes only while in system mode', () => {
    const listeners: Array<() => void> = [];
    mockSystemPrefersDark(false, listeners);

    useThemeStore.getState().setTheme('system');
    const unsubscribe = useThemeStore.getState().init();
    expect(useThemeStore.getState().resolved).toBe('light');

    mockSystemPrefersDark(true, listeners);
    listeners.forEach((cb) => cb());
    expect(useThemeStore.getState().resolved).toBe('dark');

    // Once the user picks explicitly, OS changes must be ignored.
    useThemeStore.getState().setTheme('light');
    listeners.forEach((cb) => cb());
    expect(useThemeStore.getState().resolved).toBe('light');
    unsubscribe();
  });

  it('init returns a cleanup function that detaches the listener', () => {
    const removeEventListener = vi.fn();
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener,
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    useThemeStore.getState().init()();
    expect(removeEventListener).toHaveBeenCalled();
  });
});
