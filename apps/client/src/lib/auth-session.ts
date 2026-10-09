/**
 * The one place that reads, refreshes and clears session tokens.
 *
 * Each area of the app (admin, buyer portal, mobile) has its own login — see
 * `session-identity.ts`. Every function here takes the area it acts on and defaults to the
 * area of the page you're on, so the same browser can be signed in as different people in
 * different areas without one login replacing another.
 *
 * Two ways a session ends, handled differently on purpose:
 * - `handleSessionExpired` — refresh failed. Tokens go, but the user's cart and unsynced
 *   offline work stay so the same person can sign back in and carry on.
 * - `signOut` — the user asked. The server session is revoked and everything that belongs
 *   to them in that area is wiped from this device.
 */
import { DEFAULT_GATEWAY_PATH, resolveGatewayBaseUrl } from '@pleros/web-gateway-client'
import { emitStorefrontAuthChanged } from '@/lib/auth-events'
import { parseJwtPayload } from '@/lib/jwt'
import { clearB2bSession } from '@/lib/session'
import {
  accessTokenKey,
  currentIdentity,
  currentSurface,
  migrateLegacyTokens,
  readAccessToken,
  refreshTokenKey,
  surfaceFor,
  tokenExpiresInMs,
  type Surface,
} from '@/lib/session-identity'
import { reconcileUserDataOwner, wipeUserData } from '@/lib/user-data'

export type { Surface } from '@/lib/session-identity'

const gatewayBaseUrl = resolveGatewayBaseUrl(import.meta.env?.VITE_GATEWAY_URL ?? DEFAULT_GATEWAY_PATH)

/** Refresh this long before expiry so requests never go out with a token about to lapse. */
const REFRESH_AHEAD_MS = 2 * 60 * 1000

const LOGIN_PATH: Record<Surface, string> = {
  admin: '/admin/login',
  shop: '/login',
  mobile: '/m/login',
}

export function getAccessToken(surface: Surface = currentSurface()): string | null {
  return readAccessToken(surface)
}

function getRefreshToken(surface: Surface): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(refreshTokenKey(surface))
  } catch {
    return null
  }
}

/** Store a freshly issued pair (login, invite accept, signup, refresh) for one area. */
export function setTokens(accessToken: string, refreshToken?: string | null, surface: Surface = currentSurface()) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(accessTokenKey(surface), accessToken)
  if (refreshToken) window.localStorage.setItem(refreshTokenKey(surface), refreshToken)
  reconcileUserDataOwner(surface)
}

export function clearTokens(surface: Surface = currentSurface()) {
  window.localStorage.removeItem(accessTokenKey(surface))
  window.localStorage.removeItem(refreshTokenKey(surface))
  if (surface === 'shop') clearB2bSession()
}

/** Hand a just-issued session from one area to another (invite accept decides after login). */
export function moveTokens(from: Surface, to: Surface) {
  if (from === to) return
  const access = getAccessToken(from)
  const refresh = getRefreshToken(from)
  if (!access) return
  clearTokens(from)
  setTokens(access, refresh, to)
}

export type SessionPayload = {
  sub?: string
  email?: string
  role?: string
  tenantId?: string
  permissions?: string[]
}

export function getSessionUser(surface: Surface = currentSurface()): SessionPayload | null {
  const token = getAccessToken(surface)
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

/** Signed in = a usable access token, or an expired one we can still refresh. */
export function isSignedIn(surface: Surface = currentSurface()): boolean {
  const token = getAccessToken(surface)
  if (!token) return false
  const left = tokenExpiresInMs(token)
  return left == null || left > 0 || Boolean(getRefreshToken(surface))
}

class TransientAuthError extends Error {}

async function withRefreshLock<T>(surface: Surface, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  // Web Locks serialise refresh across tabs; without them the server's rotation grace window covers the race.
  return locks ? (locks.request(`pleros-auth-refresh:${surface}`, fn) as Promise<T>) : fn()
}

const refreshInFlight: Partial<Record<Surface, Promise<string | null>>> = {}

/**
 * Exchange an area's refresh token for a new pair. Resolves the new access token, resolves
 * null when the session is over, and throws when the failure is transient (offline, 429, 5xx).
 * One refresh at a time per area per tab, and per browser where Web Locks exist.
 */
export function refreshTokens(surface: Surface = currentSurface()): Promise<string | null> {
  const pending = refreshInFlight[surface]
  if (pending) return pending
  const tokenBefore = getAccessToken(surface)
  const run = withRefreshLock(surface, async () => {
    // Another tab may have refreshed this area while we waited for the lock.
    const current = getAccessToken(surface)
    if (current && current !== tokenBefore && (tokenExpiresInMs(current) ?? 0) > REFRESH_AHEAD_MS) {
      return current
    }
    const refreshToken = getRefreshToken(surface)
    if (!refreshToken) return null
    // userId is redundant for the current API but required by older deployments.
    const userId = parseJwtPayload(refreshToken)?.sub
    let res: Response
    try {
      res = await fetch(`${gatewayBaseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken, ...(typeof userId === 'string' ? { userId } : {}) }),
      })
    } catch {
      throw new TransientAuthError('offline')
    }
    // Rate limits and server errors are worth retrying; any other 4xx means the session is over.
    if (res.status === 429 || res.status >= 500) throw new TransientAuthError(`refresh failed (${res.status})`)
    if (!res.ok) return null
    const data = (await res.json()) as { accessToken?: string; refreshToken?: string }
    if (!data.accessToken) return null
    setTokens(data.accessToken, data.refreshToken, surface)
    return data.accessToken
  }).finally(() => {
    delete refreshInFlight[surface]
  })
  refreshInFlight[surface] = run
  return run
}

/** The access token to send now for an area, refreshed first when it is close to expiry. */
export async function getFreshAccessToken(surface: Surface = currentSurface()): Promise<string | null> {
  const token = getAccessToken(surface)
  if (!token) return null
  const left = tokenExpiresInMs(token)
  if (left == null || left > REFRESH_AHEAD_MS || !getRefreshToken(surface)) return token
  try {
    return (await refreshTokens(surface)) ?? token
  } catch {
    return token
  }
}

export function loginPathFor(pathname: string): string {
  return LOGIN_PATH[surfaceFor(pathname)]
}

const LOGIN_PATHS = new Set(Object.values(LOGIN_PATH))

/** Refresh is no longer possible: drop the area's tokens and send the user to its sign-in page. */
export function handleSessionExpired(surface: Surface = currentSurface()) {
  if (typeof window === 'undefined') return
  clearTokens(surface)
  emitStorefrontAuthChanged()
  const path = window.location.pathname
  // Only redirect when this page belongs to the expired area.
  if (LOGIN_PATHS.has(path) || surfaceFor(path) !== surface) return
  const next = path && path !== '/' ? `?next=${encodeURIComponent(path + window.location.search)}` : ''
  window.location.assign(`${LOGIN_PATH[surface]}${next}`)
}

/**
 * `fetch` for endpoints the axios client can't serve (PDFs, labels, streams):
 * adds the current area's bearer token, refreshes and retries once on 401.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const surface = currentSurface()
  const send = (token: string | null) => {
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(input, { ...init, headers })
  }
  const res = await send(await getFreshAccessToken(surface))
  if (res.status !== 401) return res
  let next: string | null
  try {
    next = await refreshTokens(surface)
  } catch {
    return res
  }
  if (!next) {
    handleSessionExpired(surface)
    return res
  }
  return send(next)
}

async function revokeServerSession(surface: Surface) {
  const refreshToken = getRefreshToken(surface)
  const accessToken = getAccessToken(surface)
  try {
    await fetch(`${gatewayBaseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      // The refresh token still identifies the session after the access token has expired.
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    })
  } catch {
    /* offline — still clear the local session */
  }
}

function clearServiceWorkerApiCache() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'PLEROS_CLEAR_API_CACHE' })
  } catch {
    /* no service worker */
  }
}

/**
 * Explicit sign-out of one area (the current page's by default): revoke its server session
 * and wipe that user's data from the device. Other areas stay signed in.
 */
export async function signOut(options?: { redirectTo?: string; surface?: Surface }) {
  if (typeof window === 'undefined') return
  const surface = options?.surface ?? currentSurface()

  if (surface === 'mobile') {
    const { pendingCountFor } = await import('@/lib/offline-queue')
    const unsynced = pendingCountFor(currentIdentity('mobile'))
    if (
      unsynced > 0 &&
      !window.confirm(
        `${unsynced} offline change${unsynced === 1 ? ' has' : 's have'} not synced yet. ` +
          'They will sync next time you sign in on this device. Sign out anyway?',
      )
    ) {
      return
    }
  }

  if (getAccessToken(surface) || getRefreshToken(surface)) await revokeServerSession(surface)

  clearTokens(surface)
  wipeUserData(surface)
  // Cache partitions are per user, so clearing them all only costs other areas a refetch.
  clearServiceWorkerApiCache()
  emitStorefrontAuthChanged()

  window.location.href = options?.redirectTo ?? '/'
}

let syncInstalled = false

/**
 * Keep tabs in step: when another tab signs out of this area or a different user signs in
 * to it, this tab follows instead of carrying on with stale credentials and data. Changes to
 * other areas' logins are ignored.
 */
export function installAuthSync() {
  if (typeof window === 'undefined' || syncInstalled) return
  syncInstalled = true
  migrateLegacyTokens()
  reconcileUserDataOwner()
  window.addEventListener('storage', (event) => {
    const surface = currentSurface()
    if (event.key !== accessTokenKey(surface) && event.key !== null) return
    if (!getAccessToken(surface)) {
      const path = window.location.pathname
      if (surface !== 'shop' && !LOGIN_PATHS.has(path)) window.location.assign(LOGIN_PATH[surface])
      else emitStorefrontAuthChanged()
      return
    }
    reconcileUserDataOwner(surface)
  })
}
