import { gatewayApiBaseUrl } from '@/lib/api'
import { emitStorefrontAuthChanged } from '@/lib/auth-events'
import { clearB2bSession } from '@/lib/session'

const ACCESS_KEY = 'pleros.accessToken'
const REFRESH_KEY = 'pleros.refreshToken'

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ACCESS_KEY)
}

export type SessionPayload = {
  sub?: string
  email?: string
  role?: string
  tenantId?: string
  permissions?: string[]
}

export function getSessionUser(): SessionPayload | null {
  const token = getAccessToken()
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    )
    return JSON.parse(json) as SessionPayload
  } catch {
    return null
  }
}

export function isSignedIn(): boolean {
  return Boolean(getAccessToken())
}

async function revokeServerSession(token: string) {
  try {
    await fetch(`${gatewayApiBaseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
  } catch {
    /* offline or expired — still clear local session */
  }
}

export async function signOut(options?: { redirectTo?: string }) {
  if (typeof window === 'undefined') return

  const token = getAccessToken()
  if (token) await revokeServerSession(token)

  window.localStorage.removeItem(ACCESS_KEY)
  window.localStorage.removeItem(REFRESH_KEY)
  clearB2bSession()
  emitStorefrontAuthChanged()

  window.location.href = options?.redirectTo ?? '/'
}
