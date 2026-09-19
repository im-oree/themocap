import type { Config } from 'tailwindcss';
import preset from './tailwind.preset';

/** Canonical content globs for the monorepo; apps re-use this via `presets`. */
const config: Config = {
  presets: [preset],
  darkMode: 'class',
  content: [
    '../../apps/*/index.html',
    '../../apps/*/src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
    '../../tools/*/index.html',
    '../../tools/*/src/**/*.{ts,tsx}',
  ],
};

export default config;
