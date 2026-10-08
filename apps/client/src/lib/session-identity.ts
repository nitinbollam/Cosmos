/**
 * Who is signed in on this device, per area of the app.
 *
 * Admin, the buyer portal and the mobile app each keep their own login, so one browser can
 * be an admin in one tab, a buyer in another and a driver in a third. Signing in or out of
 * one area never touches the others.
 *
 * Dependency-free so stores, the offline queue and the auth module can all use it.
 */
import { parseJwtPayload } from '@/lib/jwt'

export type Surface = 'admin' | 'shop' | 'mobile'

/** Single shared keys used before logins were split per area; migrated on first load. */
const LEGACY_ACCESS_KEY = 'pleros.accessToken'
const LEGACY_REFRESH_KEY = 'pleros.refreshToken'

export function accessTokenKey(surface: Surface): string {
  return `pleros.${surface}.accessToken`
}

export function refreshTokenKey(surface: Surface): string {
  return `pleros.${surface}.refreshToken`
}

/** Which login a path uses. `/ops` is staff-only, so it shares the admin login. */
export function surfaceFor(pathname: string): Surface {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin'
  if (pathname === '/ops' || pathname.startsWith('/ops/')) return 'admin'
  if (pathname === '/m' || pathname.startsWith('/m/')) return 'mobile'
  return 'shop'
}

export function currentSurface(): Surface {
  if (typeof window === 'undefined' || !window.location) return 'shop'
  return surfaceFor(window.location.pathname)
}

export type SessionIdentity = { userId: string; tenantId: string }

export function readAccessToken(surface: Surface = currentSurface()): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(accessTokenKey(surface))
  } catch {
    return null
  }
}

export function identityFromToken(token: string | null): SessionIdentity | null {
  if (!token) return null
  const p = parseJwtPayload(token)
  const userId = p?.sub
  const tenantId = p?.tenantId
  return typeof userId === 'string' && typeof tenantId === 'string' ? { userId, tenantId } : null
}

export function currentIdentity(surface: Surface = currentSurface()): SessionIdentity | null {
  return identityFromToken(readAccessToken(surface))
}

/** Stable "tenant:user" key used to stamp data that belongs to one signed-in user. */
export function ownerKeyOf(identity: SessionIdentity | null): string | null {
  return identity ? `${identity.tenantId}:${identity.userId}` : null
}

/** Milliseconds until the token expires; negative when expired, null when it has no `exp`. */
export function tokenExpiresInMs(token: string | null): number | null {
  if (!token) return null
  const exp = parseJwtPayload(token)?.exp
  return typeof exp === 'number' ? exp * 1000 - Date.now() : null
}

/**
 * One-time move from the old shared login to per-area logins. The old session goes to the
 * area the user is in right now; the other areas ask them to sign in. It is never copied to
 * several areas, because they would all rotate the same refresh token and trip reuse detection.
 */
export function migrateLegacyTokens() {
  if (typeof window === 'undefined') return
  try {
    const access = window.localStorage.getItem(LEGACY_ACCESS_KEY)
    const refresh = window.localStorage.getItem(LEGACY_REFRESH_KEY)
    if (!access && !refresh) return
    const surface = currentSurface()
    if (!window.localStorage.getItem(accessTokenKey(surface))) {
      if (access) window.localStorage.setItem(accessTokenKey(surface), access)
      if (refresh) window.localStorage.setItem(refreshTokenKey(surface), refresh)
    }
    window.localStorage.removeItem(LEGACY_ACCESS_KEY)
    window.localStorage.removeItem(LEGACY_REFRESH_KEY)
  } catch {
    /* storage blocked */
  }
}
