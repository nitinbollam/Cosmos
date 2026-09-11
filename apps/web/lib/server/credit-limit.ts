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

export async function applyCreditUsed(tenantId: string, customerId: string, amount: number) {
  if (amount <= 0) return
  await crm.getCustomer(tenantId, customerId)
  await crmDb.customer.update({
    where: { id: customerId },
    data: { creditUsed: { increment: new Prisma.Decimal(amount) } },
  })
}

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

export function netTermsExposure(orderTotal: number, amountPaid: number): number {
  return Math.max(0, orderTotal - amountPaid)
}
