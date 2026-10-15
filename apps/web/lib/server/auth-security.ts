import { ApiError } from './session'

/**
 * Password policy + lightweight in-memory rate limiting for auth endpoints.
 * The limiter is per-process (fixed window); enough to stop credential
 * stuffing on a single node. Swap for Redis when running multiple replicas.
 */

const MIN_PASSWORD_LENGTH = 10

export function assertPasswordPolicy(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  if (password.length > 128) {
    throw new ApiError(400, 'Password must be at most 128 characters')
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new ApiError(400, 'Password must include at least one letter and one number')
  }
}

type WindowEntry = { count: number; resetAt: number }
const windows = new Map<string, WindowEntry>()

function sweepWindows() {
  if (windows.size < 10_000) return
  const now = Date.now()
  for (const [k, v] of windows) {
    if (v.resetAt <= now) windows.delete(k)
  }
}

/** Throws 429 when `key` exceeds `limit` requests within `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now()
  const entry = windows.get(key)
  if (!entry || entry.resetAt <= now) {
    sweepWindows()
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  entry.count += 1
  if (entry.count > limit) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    throw new ApiError(429, `Too many attempts. Try again in ${retryAfterSec}s`)
  }
}

/**
 * The caller's IP for rate limiting. `X-Forwarded-For` is "client, proxy1, proxy2…" and every
 * entry before the ones our own proxies append is whatever the caller chose to send — so the
 * first entry can't be trusted (a fresh fake IP per request would skip every per-IP limit).
 * Read the entry our proxies appended instead: `TRUSTED_PROXY_HOPS` (default 1, e.g. Render's
 * load balancer) counts back from the end.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const hops = Math.max(1, Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10) || 1)
    const parts = fwd.split(',').map((p) => p.trim()).filter(Boolean)
    const ip = parts[Math.max(0, parts.length - hops)]
    if (ip) return ip
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

export function resetRateLimits(): void {
  windows.clear()
}
