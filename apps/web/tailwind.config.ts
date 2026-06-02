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
        cosmos: {
          bg: '#DEC0F1',
          surface: '#EFD9CE',
          blush: '#F3E4F8',
          'surface-2': '#F3E4F8',
          border: 'rgba(113, 97, 239, 0.28)',
          primary: '#7161EF',
          accent: '#957FEF',
          success: '#059669',
          warning: '#D97706',
          danger: '#DC2626',
          foreground: '#2D2640',
          white: '#2D2640',
          muted: '#7A728F',
          text: '#3D3654',
          'text-2': '#5C5478',
          'text-3': '#7A728F',
        },
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
        display: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'Menlo', 'monospace'],
      },
      borderRadius: {
        bento: '10px',
      },
    },
  },
  plugins: [],
}
export default config
