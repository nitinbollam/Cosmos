import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        cosmos: {
          bg: '#06060F',
          surface: '#0D0D1A',
          'surface-2': '#13132A',
          'surface-3': '#1A1A35',
          border: '#1E1E3A',
          'border-2': '#2D2D52',
          primary: '#6366F1',
          accent: '#22D3EE',
          success: '#10B981',
          warning: '#F59E0B',
          danger: '#EF4444',
          /* legacy token names */
          white: '#F8FAFC',
          muted: '#64748B',
          text: '#E2E8F0',
          'text-2': '#94A3B8',
          'text-3': '#64748B',
        },
      },
      fontFamily: {
        sans: ['var(--font-dm-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-syne)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
export default config
