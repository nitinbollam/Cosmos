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
          muted: '#5F5775',
          text: '#3D3654',
          'text-2': '#5C5478',
          'text-3': '#7A728F',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      borderRadius: {
        bento: '10px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(45, 38, 64, 0.06)',
      },
    },
  },
  plugins: [],
}
export default config
