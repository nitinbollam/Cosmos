import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        pleros: {
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
        sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
        display: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'Menlo', 'monospace'],
      },
      borderRadius: {
        bento: '8px',
      },
    },
  },
  plugins: [],
}
export default config
