import type { Config } from 'tailwindcss';
import preset from '@wms/ui/tailwind-preset';

export default {
  presets: [preset],
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
} satisfies Config;
