export type PlerosTheme = 'obsidian' | 'aurora'

export const THEME_STORAGE_KEY = 'pleros.theme'
export const THEME_CHANGE_EVENT = 'pleros-theme-change'

const THEME_COLORS: Record<PlerosTheme, string> = {
  obsidian: '#09090B',
  aurora: '#DEC0F1',
}

export function isPlerosTheme(value: string | null | undefined): value is PlerosTheme {
  return value === 'obsidian' || value === 'aurora'
}

export function getStoredTheme(): PlerosTheme {
  if (typeof window === 'undefined') return 'obsidian'
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return isPlerosTheme(stored) ? stored : 'obsidian'
}

export function applyTheme(theme: PlerosTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', THEME_COLORS[theme])
}

export function setTheme(theme: PlerosTheme) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  applyTheme(theme)
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }))
}

export const THEME_LABELS: Record<PlerosTheme, string> = {
  obsidian: 'Obsidian',
  aurora: 'Aurora',
}
