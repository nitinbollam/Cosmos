import { Prisma } from '@/generated/prisma-crm'
import { crmDb } from './db'
import * as crm from './crm'
import { ApiError } from './session'

export async function assertCreditAvailable(
  tenantId: string,
  customerId: string,
  orderTotal: number,
  paymentMethod: string,
) {
  if (paymentMethod !== 'NET_TERMS') return
  const customer = await crm.getCustomer(tenantId, customerId)
  const limit = customer.creditLimit != null ? Number(customer.creditLimit) : null
  if (limit == null || limit <= 0) return

  const used = Number(customer.creditUsed ?? 0)
  const available = limit - used
  if (orderTotal > available + 0.001) {
    throw new ApiError(
      400,
      `Credit limit exceeded. Available $${available.toFixed(2)}, order total $${orderTotal.toFixed(2)}`,
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
