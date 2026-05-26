import { paymentDb } from './db'

const TTL_MS = 86_400_000 // 24 hours

export async function getIdempotentResponse(
  key: string,
): Promise<{ status: number; body: unknown } | null> {
  const row = await paymentDb.paymentIdempotency.findUnique({ where: { id: key } })
  if (!row) return null
  if (row.expiresAt < new Date()) {
    await paymentDb.paymentIdempotency.delete({ where: { id: key } }).catch(() => undefined)
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
  await paymentDb.paymentIdempotency.upsert({
    where: { id: key },
    create: { id: key, tenantId, status, body: body as object, expiresAt },
    update: { tenantId, status, body: body as object, expiresAt },
  })
}
