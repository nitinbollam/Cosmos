import { useCallback, useEffect, useState } from 'react'
import {
  getStoredTheme,
  setTheme,
  THEME_CHANGE_EVENT,
  THEME_LABELS,
  type CosmosTheme,
} from '@/lib/theme'

type ThemeSwitcherProps = {
  compact?: boolean
  className?: string
}

export function ThemeSwitcher({ compact = false, className = '' }: ThemeSwitcherProps) {
  const [theme, setLocalTheme] = useState<CosmosTheme>(() => getStoredTheme())

  const sync = useCallback(() => {
    setLocalTheme(getStoredTheme())
  }, [])

  useEffect(() => {
    window.addEventListener(THEME_CHANGE_EVENT, sync)
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'cosmos.theme' || e.key === null) sync()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [sync])

  function pick(next: CosmosTheme) {
    if (next === theme) return
    setLocalTheme(next)
    setTheme(next)
  }

  return (
    <div
      className={`cosmos-theme-switcher${compact ? ' cosmos-theme-switcher--compact' : ''}${className ? ` ${className}` : ''}`}
      role="group"
      aria-label="Theme"
    >
      {(['obsidian', 'aurora'] as const).map((id) => (
        <button
          key={id}
          type="button"
          className={`cosmos-theme-switcher-btn${theme === id ? ' cosmos-theme-switcher-btn--active' : ''}`}
          aria-pressed={theme === id}
          onClick={() => pick(id)}
        >
          {THEME_LABELS[id]}
        </button>
      ))}
    </div>
  )
}
