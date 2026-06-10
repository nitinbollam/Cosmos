import { paymentDb } from './db'

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
    await paymentDb.paymentIdempotency.delete({ where: { id: row.id } }).catch(() => undefined)
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
