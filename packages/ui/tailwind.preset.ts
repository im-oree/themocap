import type { Config } from 'tailwindcss';

/**
 * Shared Apple-inspired design tokens. Apps extend this preset and supply their
 * own `content` globs (see packages/ui/tailwind.config.ts for the canonical set).
 */
const preset = {
  darkMode: 'class',
  content: [],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: ['"SF Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      colors: {
        accent: {
          DEFAULT: '#0A84FF',
          light: '#007AFF',
          hover: '#3396FF',
        },
        surface: {
          light: '#F5F5F7',
          'light-elevated': '#FFFFFF',
          dark: '#000000',
          'dark-elevated': '#1C1C1E',
        },
        hairline: {
          light: 'rgba(0,0,0,0.08)',
          dark: 'rgba(255,255,255,0.08)',
        },
        content: {
          'light-primary': '#1D1D1F',
          'light-secondary': 'rgba(60,60,67,0.6)',
          'dark-primary': '#F5F5F7',
          'dark-secondary': 'rgba(235,235,245,0.6)',
        },
        success: '#30D158',
        warning: '#FFD60A',
        danger: '#FF453A',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      backdropBlur: {
        xs: '2px',
      },
      transitionTimingFunction: {
        'apple-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'apple-in': 'cubic-bezier(0.4, 0, 1, 1)',
      },
      transitionDuration: {
        180: '180ms',
        220: '220ms',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.08)',
        'panel-dark': '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.5)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
} satisfies Config;

export default preset;
