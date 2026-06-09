export type CosmosTheme = 'obsidian' | 'aurora'

export const THEME_STORAGE_KEY = 'cosmos.theme'
export const THEME_CHANGE_EVENT = 'cosmos-theme-change'

const THEME_COLORS: Record<CosmosTheme, string> = {
  obsidian: '#09090B',
  aurora: '#DEC0F1',
}

export function isCosmosTheme(value: string | null | undefined): value is CosmosTheme {
  return value === 'obsidian' || value === 'aurora'
}

export function getStoredTheme(): CosmosTheme {
  if (typeof window === 'undefined') return 'obsidian'
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return isCosmosTheme(stored) ? stored : 'obsidian'
}

export function applyTheme(theme: CosmosTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', THEME_COLORS[theme])
}

export function setTheme(theme: CosmosTheme) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  applyTheme(theme)
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }))
}

export const THEME_LABELS: Record<CosmosTheme, string> = {
  obsidian: 'Obsidian',
  aurora: 'Aurora',
}
