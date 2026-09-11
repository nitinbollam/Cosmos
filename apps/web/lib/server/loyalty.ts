import { randomBytes } from 'node:crypto'
import { LoyaltyTxnType } from '@/generated/prisma-tenant'
import { tenantDb, orderDb } from './db'
import { ApiError } from './session'
import { getTenantEngagementSettings } from './tenant-engagement-settings'
import { createDiscount } from './discounts'
import { DiscountScope, DiscountType } from '@/generated/prisma-tenant'
import { auditLog } from './audit-log'

export async function getOrCreateLoyaltyAccount(tenantId: string, customerId: string) {
  const existing = await tenantDb.loyaltyAccount.findFirst({ where: { tenantId, customerId } })
  if (existing) return existing
  return tenantDb.loyaltyAccount.create({ data: { tenantId, customerId, pointsBalance: 0 } })
}

export async function getLoyaltyAccount(tenantId: string, customerId: string) {
  return getOrCreateLoyaltyAccount(tenantId, customerId)
}

export async function earnPointsForDeliveredOrder(tenantId: string, orderId: string) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order || order.status !== 'DELIVERED') return

  const account = await getOrCreateLoyaltyAccount(tenantId, order.customerId)
  const existing = await tenantDb.loyaltyTransaction.findFirst({
    where: { accountId: account.id, type: LoyaltyTxnType.EARN, orderRef: orderId },
  })
  if (existing) return

  const { loyaltyPointsPerDollar } = await getTenantEngagementSettings(tenantId)
  const points = Math.floor(Number(order.totalAmount) * loyaltyPointsPerDollar)
  if (points <= 0) return

  await tenantDb.$transaction(async (tx) => {
    await tx.loyaltyTransaction.create({
      data: { accountId: account.id, type: LoyaltyTxnType.EARN, points, orderRef: orderId },
    })
    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { pointsBalance: { increment: points } },
    })
  })
}

export async function redeemPoints(tenantId: string, customerId: string, points: number) {
  if (points <= 0) throw new ApiError(400, 'Points must be positive')
  const account = await getOrCreateLoyaltyAccount(tenantId, customerId)
  if (account.pointsBalance < points) throw new ApiError(400, 'Insufficient loyalty points')

  const { loyaltyPointsToDollarRate } = await getTenantEngagementSettings(tenantId)
  const dollarValue = +(points * loyaltyPointsToDollarRate).toFixed(2)
  if (dollarValue <= 0) throw new ApiError(400, 'Redemption value too small')

  const code = `LOY-${randomBytes(4).toString('hex').toUpperCase()}`

  await tenantDb.$transaction(async (tx) => {
    await tx.loyaltyTransaction.create({
      data: {
        accountId: account.id,
        type: LoyaltyTxnType.REDEEM,
        points: -points,
        reason: `Redeemed for discount ${code}`,
      },
    })
    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { pointsBalance: { decrement: points } },
    })
  })

  await createDiscount(tenantId, {
    code,
    type: DiscountType.FIXED_AMOUNT,
    scope: DiscountScope.ORDER,
    amount: dollarValue,
    usageLimit: 1,
    perCustomerLimit: 1,
  })

  return { discountCode: code, dollarValue, pointsRedeemed: points }
}

export async function adjustLoyaltyPoints(
  tenantId: string,
  customerId: string,
  pointsDelta: number,
  reason: string,
  userId: string,
) {
  if (!reason.trim()) throw new ApiError(400, 'Adjustment reason is required')
  if (pointsDelta === 0) throw new ApiError(400, 'pointsDelta cannot be zero')

  const account = await getOrCreateLoyaltyAccount(tenantId, customerId)
  if (pointsDelta < 0 && account.pointsBalance + pointsDelta < 0) {
    throw new ApiError(400, 'Adjustment would make balance negative')
  }

  await tenantDb.$transaction(async (tx) => {
    await tx.loyaltyTransaction.create({
      data: {
        accountId: account.id,
        type: LoyaltyTxnType.ADJUSTMENT,
        points: pointsDelta,
        reason: reason.trim(),
      },
    })
    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { pointsBalance: { increment: pointsDelta } },
    })
  })

  await auditLog(tenantId, {
    action: 'loyalty.adjustment',
    entityType: 'LoyaltyAccount',
    entityId: account.id,
    userId,
    metadata: { customerId, pointsDelta, reason: reason.trim() },
  })

  return getOrCreateLoyaltyAccount(tenantId, customerId)
}
