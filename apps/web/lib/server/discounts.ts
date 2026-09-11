import { Prisma, DiscountScope, DiscountType } from '@/generated/prisma-tenant'
import { tenantDb } from './db'
import { ApiError } from './session'
import { getTenantWorkflowSettings } from './tenant-workflow-settings'
import { createApprovalRequest, findPendingApprovalForSubject } from './approvals'
import { ApprovalType } from '@/generated/prisma-tenant'

export type CreateDiscountInput = {
  code?: string | null
  type: DiscountType
  scope: DiscountScope
  amount: number
  minPurchase?: number | null
  startsAt?: Date | null
  expiresAt?: Date | null
  usageLimit?: number | null
  perCustomerLimit?: number | null
}

function dec(v: unknown): number {
  if (v == null) return 0
  return Number(v)
}

export function computeAmountOff(
  discount: { type: DiscountType; scope: DiscountScope; amount: Prisma.Decimal },
  orderSubtotal: number,
): number {
  const amt = dec(discount.amount)
  if (discount.type === DiscountType.PERCENTAGE) {
    const pct = Math.min(100, Math.max(0, amt))
    return +((orderSubtotal * pct) / 100).toFixed(2)
  }
  return +Math.min(orderSubtotal, amt).toFixed(2)
}

function effectivePercent(amountOff: number, orderSubtotal: number): number {
  if (orderSubtotal <= 0) return 0
  return (amountOff / orderSubtotal) * 100
}

export async function createDiscount(tenantId: string, input: CreateDiscountInput) {
  const code = input.code?.trim() || null
  if (code && code.length < 2) throw new ApiError(400, 'Discount code must be at least 2 characters')
  if (input.amount < 0) throw new ApiError(400, 'amount must be non-negative')
  if (input.type === DiscountType.PERCENTAGE && input.amount > 100) {
    throw new ApiError(400, 'Percentage discount cannot exceed 100')
  }
  return tenantDb.discount.create({
    data: {
      tenantId,
      code,
      type: input.type,
      scope: input.scope,
      amount: new Prisma.Decimal(input.amount),
      minPurchase: input.minPurchase != null ? new Prisma.Decimal(input.minPurchase) : null,
      startsAt: input.startsAt ?? null,
      expiresAt: input.expiresAt ?? null,
      usageLimit: input.usageLimit ?? null,
      perCustomerLimit: input.perCustomerLimit ?? null,
    },
  })
}

export async function listDiscounts(tenantId: string) {
  return tenantDb.discount.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function deactivateDiscount(tenantId: string, id: string) {
  const row = await tenantDb.discount.findFirst({ where: { id, tenantId } })
  if (!row) throw new ApiError(404, 'Discount not found')
  return tenantDb.discount.update({ where: { id }, data: { isActive: false } })
}

export async function redeemDiscount(
  tenantId: string,
  discountId: string,
  input: { orderId?: string; customerId?: string; amountOff: number },
) {
  if (input.amountOff <= 0) return
  await tenantDb.$transaction(async (tx) => {
    const discount = await tx.discount.findFirst({ where: { id: discountId, tenantId } })
    if (!discount) throw new ApiError(404, 'Discount not found')
    await tx.discount.update({
      where: { id: discountId },
      data: { timesUsed: { increment: 1 } },
    })
    await tx.discountRedemption.create({
      data: {
        discountId,
        orderId: input.orderId ?? null,
        customerId: input.customerId ?? null,
        amountOff: new Prisma.Decimal(input.amountOff),
      },
    })
  })
}

export type ValidateDiscountResult =
  | { valid: true; discount: Awaited<ReturnType<typeof tenantDb.discount.findFirst>>; amountOff: number }
  | { valid: false; reason: string }
  | {
      valid: true
      pendingApproval: true
      approvalId: string
      amountOff: number
      discount: NonNullable<Awaited<ReturnType<typeof tenantDb.discount.findFirst>>>
    }

export async function validateDiscount(
  tenantId: string,
  code: string,
  context: { orderSubtotal: number; customerId?: string; requestedBy?: string },
): Promise<ValidateDiscountResult> {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return { valid: false, reason: 'Enter a discount code' }
  if (context.orderSubtotal <= 0) return { valid: false, reason: 'Cart is empty' }

  const discount = await tenantDb.discount.findFirst({
    where: { tenantId, code: normalized, isActive: true },
  })
  if (!discount) return { valid: false, reason: 'Invalid or inactive discount code' }

  const now = new Date()
  if (discount.startsAt && now < discount.startsAt) {
    return { valid: false, reason: 'Discount is not active yet' }
  }
  if (discount.expiresAt && now > discount.expiresAt) {
    return { valid: false, reason: 'Discount has expired' }
  }
  if (discount.minPurchase != null && context.orderSubtotal < dec(discount.minPurchase)) {
    return {
      valid: false,
      reason: `Minimum purchase $${dec(discount.minPurchase).toFixed(2)} required`,
    }
  }
  if (discount.usageLimit != null && discount.timesUsed >= discount.usageLimit) {
    return { valid: false, reason: 'Discount usage limit reached' }
  }
  if (context.customerId && discount.perCustomerLimit != null) {
    const used = await tenantDb.discountRedemption.count({
      where: { discountId: discount.id, customerId: context.customerId },
    })
    if (used >= discount.perCustomerLimit) {
      return { valid: false, reason: 'Discount limit reached for this customer' }
    }
  }

  const amountOff = computeAmountOff(discount, context.orderSubtotal)
  if (amountOff <= 0) return { valid: false, reason: 'Discount does not apply to this order' }

  const { discountApprovalThresholdPct } = await getTenantWorkflowSettings(tenantId)
  const pct = effectivePercent(amountOff, context.orderSubtotal)

  if (pct > discountApprovalThresholdPct + 0.001) {
    const approvedRows = await tenantDb.approvalRequest.findMany({
      where: {
        tenantId,
        type: ApprovalType.DISCOUNT,
        subjectId: discount.id,
        status: 'APPROVED',
        decidedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { decidedAt: 'desc' },
      take: 5,
    })
    const recentApproved = approvedRows.find((row) => {
      const ctx = row.context as { customerId?: string | null } | null
      if (!context.customerId) return true
      return ctx?.customerId === context.customerId
    })
    if (!recentApproved) {
      const pending = await findPendingApprovalForSubject(tenantId, ApprovalType.DISCOUNT, discount.id)
      if (pending) {
        return {
          valid: true,
          pendingApproval: true,
          approvalId: pending.id,
          amountOff,
          discount,
        }
      }
      const approval = await createApprovalRequest(tenantId, {
        type: ApprovalType.DISCOUNT,
        subjectId: discount.id,
        requestedBy: context.requestedBy ?? 'system',
        context: {
          code: normalized,
          amountOff,
          orderSubtotal: context.orderSubtotal,
          effectivePct: pct,
          thresholdPct: discountApprovalThresholdPct,
          customerId: context.customerId ?? null,
        },
      })
      return {
        valid: true,
        pendingApproval: true,
        approvalId: approval.id,
        amountOff,
        discount,
      }
    }
  }

  return { valid: true, discount, amountOff }
}
