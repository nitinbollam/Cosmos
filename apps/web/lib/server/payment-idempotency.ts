import { paymentDb } from './db'
import { ApiError } from './session'

import { swallowed } from './fire-and-forget'
const TTL_MS = 86_400_000 // 24 hours

/** Keys are tenant-scoped so two tenants reusing the same header value never collide. */
function scopedKey(tenantId: string, key: string): string {
  return `${tenantId}:${key}`
}

export async function getIdempotentResponse(
  tenantId: string,
  key: string,
): Promise<{ status: number; body: unknown } | null> {
  const row = await paymentDb.paymentIdempotency.findUnique({
    where: { id: scopedKey(tenantId, key) },
  })
  if (!row) return null
  if (row.expiresAt < new Date()) {
    await paymentDb.paymentIdempotency.delete({ where: { id: row.id } }).catch(swallowed('payment-idempotency.getIdempotentResponse', { level: 'warn' }))
    return null
  }
  return { status: row.status, body: row.body }
}

export async function setIdempotentResponse(
  key: string,
  tenantId: string,
  status: number,
  body: unknown,
): Promise<void> {
  const expiresAt = new Date(Date.now() + TTL_MS)
  const id = scopedKey(tenantId, key)
  await paymentDb.paymentIdempotency.upsert({
    where: { id },
    create: { id, tenantId, status, body: body as object, expiresAt },
    update: { tenantId, status, body: body as object, expiresAt },
  })
}

/** Status stored while the first request for a key is still running. */
export const IDEMPOTENCY_IN_PROGRESS = 102

/**
 * Claim a key before doing the work, so two identical requests arriving together can't both
 * run. Returns false when the key is already claimed (in progress or finished).
 */
export async function reserveIdempotencyKey(tenantId: string, key: string): Promise<boolean> {
  try {
    await paymentDb.paymentIdempotency.create({
      data: {
        id: scopedKey(tenantId, key),
        tenantId,
        status: IDEMPOTENCY_IN_PROGRESS,
        body: {},
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    })
    return true
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') return false
    throw e
  }
}

/** Drop a claim whose work failed, so the client can retry with the same key. */
export async function releaseIdempotencyKey(tenantId: string, key: string): Promise<void> {
  await paymentDb.paymentIdempotency.delete({ where: { id: scopedKey(tenantId, key) } }).catch(swallowed('payment-idempotency.releaseIdempotencyKey', { level: 'warn' }))
}

/**
 * Run `work` at most once per tenant + key and return its stored result. A duplicate that arrives
 * while the first is still running gets 409 (`busyMessage`); one that arrives afterwards gets the
 * original result. A failure frees the key so the client can retry with it.
 */
export async function runOnce(
  tenantId: string,
  key: string,
  status: number,
  work: () => Promise<unknown>,
  busyMessage = 'This request is already being processed',
): Promise<{ status: number; body: unknown }> {
  const previous = await getIdempotentResponse(tenantId, key)
  if (previous && previous.status !== IDEMPOTENCY_IN_PROGRESS) return previous
  if (previous || !(await reserveIdempotencyKey(tenantId, key))) throw new ApiError(409, busyMessage)
  try {
    // JSON round-trip: the stored copy must be plain JSON (Decimals, Dates) like the response.
    const body = JSON.parse(JSON.stringify(await work()))
    await setIdempotentResponse(key, tenantId, status, body)
    return { status, body }
  } catch (e) {
    await releaseIdempotencyKey(tenantId, key)
    throw e
  }
}
