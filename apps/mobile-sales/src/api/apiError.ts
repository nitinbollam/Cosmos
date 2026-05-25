import axios from 'axios'

export function apiErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as { message?: unknown } | undefined
    const m = d?.message
    if (Array.isArray(m)) return m.map(String).join(', ')
    if (typeof m === 'string') return m
    if (e.message) return e.message
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}
