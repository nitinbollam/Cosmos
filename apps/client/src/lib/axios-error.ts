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

/** True only for a real 404, so lookups can tell "nothing there" from "couldn't check". */
export function isNotFound(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 404
}

/** True for a 403: the user lacks the permission, so retrying won't help. */
export function isForbidden(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 403
}

export function isUnauthorized(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 401
}

export function isEmailVerificationRequired(e: unknown): boolean {
  if (!axios.isAxiosError(e) || e.response?.status !== 403) return false
  return axiosErr(e).toLowerCase().includes('verify your email')
}
