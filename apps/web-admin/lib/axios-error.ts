export function axiosErr(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(data)) return data.join(', ')
    if (typeof data === 'string') return data
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}
