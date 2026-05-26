import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  // admin + shop + mobile PWA
  theme: {
    extend: {
      colors: {
        cosmos: {
          bg: '#13151A',
          surface: '#FFFFFF',
          blush: '#F4F6F9',
          'surface-2': '#F8FAFC',
          border: '#E2E8F0',
          primary: '#6366F1',
          accent: '#6366F1',
          success: '#059669',
          warning: '#D97706',
          danger: '#DC2626',
          foreground: '#0F172A',
          white: '#F1F5F9',
          muted: '#94A3B8',
          text: '#334155',
          'text-2': '#64748B',
          'text-3': '#94A3B8',
        },
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
        display: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'Menlo', 'monospace'],
      },
      borderRadius: {
        bento: '24px',
      },
    },
  },
  plugins: [],
}
export default config
