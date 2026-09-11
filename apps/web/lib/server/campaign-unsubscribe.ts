import { createHmac, timingSafeEqual } from 'node:crypto'
import { jwtSecret } from './env'
import { tenantDb } from './db'

const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000

function sign(payload: string): string {
  return createHmac('sha256', jwtSecret()).update(payload).digest('base64url')
}

export function createUnsubscribeToken(tenantId: string, customerId: string): string {
  const exp = Date.now() + TOKEN_TTL_MS
  const payload = `${tenantId}:${customerId}:${exp}`
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`
}

export function verifyUnsubscribeToken(token: string): { tenantId: string; customerId: string } | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const payload = Buffer.from(parts[0]!, 'base64url').toString('utf8')
  const expected = sign(payload)
  const sigBuf = Buffer.from(parts[1]!)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null

  const [tenantId, customerId, expStr] = payload.split(':')
  if (!tenantId || !customerId || !expStr) return null
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Date.now()) return null
  return { tenantId, customerId }
}

export async function suppressCustomer(tenantId: string, customerId: string, reason?: string) {
  const { crmDb } = await import('./db')
  const customer = await crmDb.customer.findFirst({ where: { id: customerId, tenantId } })
  const email = customer?.email?.trim().toLowerCase() ?? null

  const existing = await tenantDb.customerSuppression.findFirst({
    where: {
      tenantId,
      OR: [{ customerId }, ...(email ? [{ email }] : [])],
    },
  })
  if (existing) return existing

  return tenantDb.customerSuppression.create({
    data: {
      tenantId,
      customerId,
      email,
      reason: reason ?? 'Unsubscribed via campaign link',
    },
  })
}

export async function isCustomerSuppressed(
  tenantId: string,
  customerId: string,
  email?: string | null,
): Promise<boolean> {
  const normalized = email?.trim().toLowerCase()
  const hit = await tenantDb.customerSuppression.findFirst({
    where: {
      tenantId,
      OR: [
        { customerId },
        ...(normalized ? [{ email: normalized }] : []),
      ],
    },
  })
  return Boolean(hit)
}
