import { useCallback, useEffect, useState } from 'react'
import {
  getStoredTheme,
  setTheme,
  THEME_CHANGE_EVENT,
  THEME_LABELS,
  type PlerosTheme,
} from '@/lib/theme'

type ThemeSwitcherProps = {
  compact?: boolean
  className?: string
}

export function ThemeSwitcher({ compact = false, className = '' }: ThemeSwitcherProps) {
  const [theme, setLocalTheme] = useState<PlerosTheme>(() => getStoredTheme())

  const sync = useCallback(() => {
    setLocalTheme(getStoredTheme())
  }, [])

  useEffect(() => {
    window.addEventListener(THEME_CHANGE_EVENT, sync)
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'pleros.theme' || e.key === null) sync()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [sync])

  function pick(next: PlerosTheme) {
    if (next === theme) return
    setLocalTheme(next)
    setTheme(next)
  }

  return (
    <div
      className={`pleros-theme-switcher${compact ? ' pleros-theme-switcher--compact' : ''}${className ? ` ${className}` : ''}`}
      role="group"
      aria-label="Theme"
    >
      {(['obsidian', 'aurora'] as const).map((id) => (
        <button
          key={id}
          type="button"
          className={`pleros-theme-switcher-btn${theme === id ? ' pleros-theme-switcher-btn--active' : ''}`}
          aria-pressed={theme === id}
          onClick={() => pick(id)}
        >
          {THEME_LABELS[id]}
        </button>
      ))}
    </div>
  )
}
