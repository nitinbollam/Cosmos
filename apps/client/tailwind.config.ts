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
        cosmos: {
          bg: '#09090B',
          surface: '#141416',
          blush: '#18181B',
          'surface-2': '#1A1A1D',
          border: 'rgba(255, 255, 255, 0.08)',
          primary: '#5B8DEF',
          accent: '#6B9FD4',
          success: '#34D399',
          warning: '#FBBF24',
          danger: '#F87171',
          foreground: '#FAFAFA',
          white: '#FAFAFA',
          muted: '#71717A',
          text: '#E4E4E7',
          'text-2': '#A1A1AA',
          'text-3': '#71717A',
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
