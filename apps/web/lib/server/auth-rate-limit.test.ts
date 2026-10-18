import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { authDb } from './db'
import { clientIp, rateLimit } from './auth-security'
import { ApiError, toJsonError } from './session'

const key = () => `test:${randomUUID()}`

async function attempts(k: string, n: number, limit: number, windowMs = 60_000) {
  return Promise.allSettled(Array.from({ length: n }, () => rateLimit(k, limit, windowMs)))
}

test('concurrent attempts share one counter: exactly `limit` pass, the rest get 429', async () => {
  const k = key()
  const results = await attempts(k, 25, 10)
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10)
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  assert.equal(rejected.length, 15)
  assert.ok(rejected.every((r) => r.reason instanceof ApiError && r.reason.status === 429))
})

test('counters live in the database, so they survive a process restart and are shared between instances', async () => {
  const k = key()
  await attempts(k, 3, 10)
  // Another instance (or the same one after a restart) reads the same row.
  const row = await authDb.rateLimitBucket.findUniqueOrThrow({ where: { key: k } })
  assert.equal(row.count, 3)
  assert.ok(Number(row.resetAtMs) > Date.now())
  await attempts(k, 7, 10) // reaches the limit exactly
  await assert.rejects(() => rateLimit(k, 10, 60_000), (e: unknown) => e instanceof ApiError && e.status === 429)
})

test('429 carries Retry-After and the same body regardless of which account was targeted', async () => {
  const k = key()
  await attempts(k, 2, 1)
  const err = await rateLimit(k, 1, 60_000).then(
    () => null,
    (e) => e as ApiError,
  )
  assert.ok(err)
  const res = toJsonError(err)
  assert.equal(res.status, 429)
  const retry = Number(res.headers.get('retry-after'))
  assert.ok(retry >= 1 && retry <= 60)
  const body = (await res.json()) as { message: string }
  assert.match(body.message, /^Too many attempts\. Try again in \d+s$/)
})

test('the window resets after it expires', async () => {
  const k = key()
  await rateLimit(k, 1, 40)
  await assert.rejects(() => rateLimit(k, 1, 40))
  await new Promise((r) => setTimeout(r, 70))
  await rateLimit(k, 1, 40)
})

test('a spoofed X-Forwarded-For prefix does not create a new bucket', () => {
  const req = (xff: string) => new Request('http://x', { headers: { 'x-forwarded-for': xff } })
  // One trusted proxy appended the real client IP last; everything before it is attacker-chosen.
  assert.equal(clientIp(req('6.6.6.6, 203.0.113.9')), '203.0.113.9')
  assert.equal(clientIp(req('7.7.7.7, 8.8.8.8, 203.0.113.9')), '203.0.113.9')
  assert.equal(clientIp(req('203.0.113.9')), '203.0.113.9')
})

test('if the shared store fails, logins keep working under the in-memory fallback (logged, never silent)', async () => {
  const k = key()
  const original = authDb.$queryRaw
  const logged: string[] = []
  const origErr = console.error
  const origLog = console.log
  console.error = (...a: unknown[]) => void logged.push(a.join(' '))
  console.log = (...a: unknown[]) => void logged.push(a.join(' '))
  ;(authDb as unknown as { $queryRaw: unknown }).$queryRaw = () => Promise.reject(new Error('db down'))
  try {
    await rateLimit(k, 2, 60_000)
    await rateLimit(k, 2, 60_000)
    await assert.rejects(() => rateLimit(k, 2, 60_000), (e: unknown) => e instanceof ApiError && e.status === 429)
  } finally {
    ;(authDb as unknown as { $queryRaw: unknown }).$queryRaw = original
    console.error = origErr
    console.log = origLog
  }
  assert.ok(logged.some((l) => l.includes('shared store unavailable')))
  assert.ok(logged.some((l) => l.includes('rate_limit_store_errors')))
})

test('coverage: every sensitive auth route applies a rate limit', () => {
  const src = readFileSync(new URL('../../server/api-router.ts', import.meta.url), 'utf8')
  const parts = src.split("if (pathname === '/api/v1/auth/").slice(1)
  const exempt = new Set(['me', 'logout']) // authenticated reads / session end, no secret guessing
  const uncovered: string[] = []
  const seen: string[] = []
  for (const part of parts) {
    const route = part.slice(0, part.indexOf("'"))
    seen.push(route)
    const block = part.slice(0, part.indexOf("if (pathname === '/api/v1/", 10) >= 0 ? part.indexOf("if (pathname === '/api/v1/", 10) : part.length)
    const code = block.replace(/\/\/.*$/gm, '') // a commented-out limiter does not count
    if (!exempt.has(route) && !/await rateLimit\(/.test(code)) uncovered.push(route)
  }
  for (const r of ['login', 'signup', 'forgot-password', 'reset-password', 'accept-invite', 'change-password', 'verify-email', 'resend-verification', 'refresh']) {
    assert.ok(seen.includes(r), `route ${r} not found - coverage test needs updating`)
  }
  assert.deepEqual(uncovered, [], `auth routes without a rate limit: ${uncovered.join(', ')}`)
})
