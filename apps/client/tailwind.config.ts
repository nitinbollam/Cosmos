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
          bg: '#AEE2E6',
          surface: '#FFF5E1',
          blush: '#FFF0D4',
          'surface-2': '#FFF0D4',
          border: '#1A202C',
          primary: '#1A202C',
          accent: '#1A202C',
          success: '#059669',
          warning: '#D97706',
          danger: '#DC2626',
          foreground: '#1A202C',
          white: '#1A202C',
          muted: '#718096',
          text: '#1A202C',
          'text-2': '#718096',
          'text-3': '#718096',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      borderRadius: {
        bento: '8px',
      },
      boxShadow: {
        card: 'none',
      },
    },
  },
  plugins: [],
}
export default config
