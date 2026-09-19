import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { wasmAlias } from './wasmAlias';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify('0.1.0-test'),
  },
  resolve: { alias: wasmAlias },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    // Playwright specs live in tests/e2e and must not be picked up by Vitest.
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
  },
});
