import { Prisma } from '@/generated/prisma-crm'
import { crmDb, orderDb } from './db'
import * as crm from './crm'
import { ApiError } from './session'
import { invoiceBalance } from './invoice-status'

export async function getCustomerOpenArBalance(tenantId: string, customerId: string): Promise<number> {
  const rows = await orderDb.invoice.findMany({
    where: { tenantId, order: { customerId } },
    select: {
      totalAmount: true,
      amountPaid: true,
      amountCredited: true,
      order: { select: { status: true } },
    },
  })
  let balance = 0
  for (const inv of rows) {
    if (inv.order.status === 'CANCELLED') continue
    balance += invoiceBalance(Number(inv.totalAmount), Number(inv.amountPaid), Number(inv.amountCredited))
  }
  return +balance.toFixed(2)
}

export type CreditLimitCheck =
  | { ok: true }
  | {
      ok: false
      requiresApproval: true
      openBalance: number
      creditLimit: number
      orderTotal: number
      projectedTotal: number
    }

export async function checkCreditLimitForOrder(
  tenantId: string,
  customerId: string,
  orderTotal: number,
  paymentMethod: string,
): Promise<CreditLimitCheck> {
  if (paymentMethod !== 'NET_TERMS') return { ok: true }
  const customer = await crm.getCustomer(tenantId, customerId)
  const limit = customer.creditLimit != null ? Number(customer.creditLimit) : null
  if (limit == null || limit <= 0) return { ok: true }

  const openBalance = await getCustomerOpenArBalance(tenantId, customerId)
  const projectedTotal = openBalance + orderTotal
  if (projectedTotal > limit + 0.001) {
    return {
      ok: false,
      requiresApproval: true,
      openBalance,
      creditLimit: limit,
      orderTotal,
      projectedTotal: +projectedTotal.toFixed(2),
    }
  }
  return { ok: true }
}

export async function assertCreditAvailable(
  tenantId: string,
  customerId: string,
  orderTotal: number,
  paymentMethod: string,
) {
  const check = await checkCreditLimitForOrder(tenantId, customerId, orderTotal, paymentMethod)
  if (!check.ok) {
    throw new ApiError(
      400,
      `Credit limit exceeded. Open balance $${check.openBalance.toFixed(2)}, limit $${check.creditLimit.toFixed(2)}, order $${orderTotal.toFixed(2)}`,
    )
  }
}

/**
 * Adds an order's terms exposure to the customer's used credit. With an `orderId` it happens at
 * most once per order: the application is recorded in the same transaction as the increment, and
 * a repeat call (a retried saga) returns without effect.
 */
export async function applyCreditUsed(tenantId: string, customerId: string, amount: number, orderId?: string) {
  if (amount <= 0) return
  await crm.getCustomer(tenantId, customerId)
  const inc = new Prisma.Decimal(amount)
  if (!orderId) {
    await crmDb.customer.update({ where: { id: customerId }, data: { creditUsed: { increment: inc } } })
    return
  }
  await crmDb.$transaction(async (tx) => {
    if (await tx.creditApplication.findFirst({ where: { tenantId, orderId } })) return
    await tx.creditApplication.create({ data: { tenantId, orderId, customerId, amount: inc } })
    await tx.customer.update({ where: { id: customerId }, data: { creditUsed: { increment: inc } } })
  })
}

/** Releases up to `amount` of used credit. Not idempotent on its own: see releaseOrderCredit for cancels. */
export async function releaseCreditUsed(tenantId: string, customerId: string, amount: number) {
  if (amount <= 0) return
  const customer = await crm.getCustomer(tenantId, customerId)
  const used = Number(customer.creditUsed ?? 0)
  const release = Math.min(amount, used)
  if (release <= 0) return
  await crmDb.customer.update({
    where: { id: customerId },
    data: { creditUsed: { decrement: new Prisma.Decimal(release) } },
  })
}

/**
 * Releases an order's remaining credit exposure when it is cancelled, exactly once. The release
 * mark and the decrement commit together, so retrying a cancel after a crash neither skips the
 * release nor repeats it. Orders that predate the application record get one on first release.
 */
export async function releaseOrderCredit(tenantId: string, customerId: string, orderId: string, amount: number) {
  await crm.getCustomer(tenantId, customerId)
  await crmDb.$transaction(async (tx) => {
    const existing = await tx.creditApplication.findFirst({ where: { tenantId, orderId } })
    if (existing?.releasedAt) return
    const claimed = existing
      ? await tx.creditApplication.updateMany({
          where: { id: existing.id, tenantId, releasedAt: null },
          data: { releasedAt: new Date() },
        })
      : null
    if (claimed && claimed.count !== 1) return
    if (!existing) {
      await tx.creditApplication.create({
        data: { tenantId, orderId, customerId, amount: new Prisma.Decimal(amount), releasedAt: new Date() },
      })
    }
    const customer = await tx.customer.findFirst({ where: { id: customerId, tenantId }, select: { creditUsed: true } })
    const release = Math.min(amount, Number(customer?.creditUsed ?? 0))
    if (release > 0) {
      await tx.customer.update({
        where: { id: customerId },
        data: { creditUsed: { decrement: new Prisma.Decimal(release) } },
      })
    }
  })
}

export function netTermsExposure(orderTotal: number, amountPaid: number): number {
  return Math.max(0, orderTotal - amountPaid)
}
