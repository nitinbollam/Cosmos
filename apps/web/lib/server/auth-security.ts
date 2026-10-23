import { ApiError } from './session'

import { swallowed } from './fire-and-forget'
/**
 * Password policy + shared rate limiting for auth endpoints.
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

/**
 * Shared fixed-window limiter (PLR-160).
 *
 * Counters live in the auth database (RateLimitBucket), updated with ONE atomic upsert, so every
 * server instance sees the same count and counts survive restarts. If the database is unreachable
 * the limiter degrades to a per-process in-memory window (logged, with a metric) instead of failing
 * logins - availability over strictness, but never silently.
 */
type WindowEntry = { count: number; resetAt: number }
const fallbackWindows = new Map<string, WindowEntry>()
const SWEEP_EVERY = 200
let calls = 0

function fallbackHit(key: string, windowMs: number, now: number): WindowEntry {
  if (fallbackWindows.size > 10_000) {
    for (const [k, v] of fallbackWindows) if (v.resetAt <= now) fallbackWindows.delete(k)
  }
  const entry = fallbackWindows.get(key)
  if (!entry || entry.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs }
    fallbackWindows.set(key, fresh)
    return fresh
  }
  entry.count += 1
  return entry
}

async function storeHit(key: string, windowMs: number, now: number): Promise<WindowEntry> {
  const { authDb } = await import('./db')
  const resetAt = BigInt(now + windowMs)
  const nowMs = BigInt(now)
  const rows = await authDb.$queryRaw<Array<{ count: number | bigint; resetAtMs: number | bigint }>>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAtMs")
    VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAtMs" <= ${nowMs} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAtMs" = CASE WHEN "RateLimitBucket"."resetAtMs" <= ${nowMs} THEN ${resetAt} ELSE "RateLimitBucket"."resetAtMs" END
    RETURNING "count", "resetAtMs"`
  const row = rows[0]
  if (++calls % SWEEP_EVERY === 0) {
    void authDb.rateLimitBucket.deleteMany({ where: { resetAtMs: { lte: nowMs } } }).catch(swallowed('auth-security.storeHit', { level: 'warn' }))
  }
  return { count: Number(row.count), resetAt: Number(row.resetAtMs) }
}

/** Throws 429 (with Retry-After) when `key` exceeds `limit` requests within `windowMs`. */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const now = Date.now()
  let entry: WindowEntry
  try {
    entry = await storeHit(key, windowMs, now)
  } catch (err) {
    console.error('[rate-limit] shared store unavailable, using in-memory fallback:', err instanceof Error ? err.message : err)
    console.log('[metric] rate_limit_store_errors 1')
    entry = fallbackHit(key, windowMs, now)
  }
  if (entry.count > limit) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    throw new ApiError(429, `Too many attempts. Try again in ${retryAfterSec}s`, {
      'Retry-After': String(retryAfterSec),
    })
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

/** Test helper: clear shared and in-memory counters. */
export async function resetRateLimits(): Promise<void> {
  fallbackWindows.clear()
  const { authDb } = await import('./db')
  await authDb.rateLimitBucket.deleteMany({})
}
