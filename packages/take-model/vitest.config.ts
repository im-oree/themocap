import { defineConfig } from 'vitest/config';

/** Pure data/logic package: no DOM needed, so the fast node environment. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
