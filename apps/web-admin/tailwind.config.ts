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
          border: '#1E1E3A',
          primary: '#6366F1',
          accent: '#22D3EE',
          success: '#10B981',
          warning: '#F59E0B',
          danger: '#EF4444',
          white: '#F1F5F9',
          muted: '#64748B',
          text: '#CBD5E1',
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
export default config
