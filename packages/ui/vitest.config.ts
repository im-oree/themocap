import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The UI package's own test runner.
 *
 * jsdom rather than node: these are components and browser-storage helpers, and
 * `localStorage` in particular has to be the real (jsdom) implementation so the
 * persistence tests exercise the same quota/serialisation path the app does.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
