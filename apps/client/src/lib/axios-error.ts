import axios from 'axios'

/** Human-readable message from a failed axios/API call. */
export function axiosErr(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(data)) return data.join(', ')
    if (typeof data === 'string') return data
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

export function isUnauthorized(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 401
}

export function isEmailVerificationRequired(e: unknown): boolean {
  if (!axios.isAxiosError(e) || e.response?.status !== 403) return false
  return axiosErr(e).toLowerCase().includes('verify your email')
}
