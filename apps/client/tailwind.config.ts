import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        pleros: {
          bg: 'var(--c-bg)',
          surface: 'var(--c-surface)',
          blush: 'var(--c-surface-blush)',
          'surface-2': 'var(--c-surface-2)',
          'surface-3': 'var(--c-surface-3)',
          border: 'var(--c-border)',
          'border-card': 'var(--c-border-card)',
          primary: 'var(--c-primary)',
          'primary-hover': 'var(--c-primary-hover)',
          'primary-dim': 'var(--c-primary-dim)',
          accent: 'var(--c-accent)',
          'accent-soft': 'var(--c-accent-soft)',
          'accent-dim': 'var(--c-accent-dim)',
          success: 'var(--c-success)',
          'success-soft': 'var(--c-success-soft)',
          warning: 'var(--c-warning)',
          'warning-soft': 'var(--c-warning-soft)',
          danger: 'var(--c-danger)',
          'danger-soft': 'var(--c-danger-soft)',
          foreground: 'var(--c-heading)',
          white: 'var(--c-heading)',
          muted: 'var(--c-text-3)',
          text: 'var(--c-text)',
          'text-2': 'var(--c-text-2)',
          'text-3': 'var(--c-text-3)',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        display: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      borderRadius: {
        bento: '8px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0, 0, 0, 0.4)',
      },
    },
  },
  plugins: [],
}
export default config
