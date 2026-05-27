import { useTheme, type ThemeMode } from '@/components/cosmos/theme-provider'

const options: { id: ThemeMode; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
]

export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, ready } = useTheme()

  if (!ready) {
    return <div className="theme-switch skeleton h-10 w-[108px] rounded-xl" aria-hidden />
  }

  return (
    <div
      className="theme-switch inline-flex items-center gap-0.5 rounded-xl p-1"
      role="group"
      aria-label="Color theme"
    >
      {options.map((opt) => {
        const active = theme === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => setTheme(opt.id)}
            className="theme-switch-btn rounded-lg font-semibold transition-colors"
            style={{
              padding: compact ? '6px 10px' : '7px 12px',
              fontSize: compact ? '11px' : '12px',
              background: active ? 'var(--c-theme-switch-active-bg)' : 'transparent',
              color: active ? 'var(--c-theme-switch-active-fg)' : 'var(--c-theme-switch-fg)',
              boxShadow: active ? 'var(--c-theme-switch-active-shadow)' : 'none',
            }}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
