import { marketplaceDb } from './db'
import {
  MARKETPLACE_DISPUTE_SUSPEND_MIN_ORDERS,
  MARKETPLACE_DISPUTE_SUSPEND_RATE,
  MARKETPLACE_MAX_BUYER_STRIKES,
} from './marketplace-constants'
import { getOrCreateMarketplaceProfile } from './marketplace-profiles'
import { ApiError } from './session'

export async function assertSellerCanList(tenantId: string): Promise<void> {
  const profile = await marketplaceDb.marketplaceProfile.findUnique({ where: { tenantId } })
  if (profile?.listingSuspended) {
    throw new ApiError(403, profile.suspensionReason ?? 'Marketplace listing privileges are suspended')
  }
}

export async function applyBuyerStrike(tenantId: string, reason: string): Promise<number> {
  await getOrCreateMarketplaceProfile(tenantId)
  const profile = await marketplaceDb.marketplaceProfile.update({
    where: { tenantId },
    data: { strikeCount: { increment: 1 } },
  })
  const strikes = profile.strikeCount
  if (strikes >= MARKETPLACE_MAX_BUYER_STRIKES) {
    await marketplaceDb.marketplaceProfile.update({
      where: { tenantId },
      data: { listingSuspended: true, suspensionReason: reason },
    })
  }
  return strikes
}

export async function checkAndSuspendForDisputes(tenantId: string): Promise<void> {
  const [completed, disputed] = await Promise.all([
    marketplaceDb.marketplaceOrder.count({
      where: { sellerTenantId: tenantId, orderStatus: 'COMPLETED' },
    }),
    marketplaceDb.marketplaceOrder.count({
      where: { sellerTenantId: tenantId, orderStatus: 'DISPUTED' },
    }),
  ])
  const total = completed + disputed
  if (total < MARKETPLACE_DISPUTE_SUSPEND_MIN_ORDERS) return
  const rate = disputed / total
  if (rate >= MARKETPLACE_DISPUTE_SUSPEND_RATE) {
    await marketplaceDb.marketplaceProfile.updateMany({
      where: { tenantId },
      data: {
        listingSuspended: true,
        suspensionReason: `Dispute rate ${(rate * 100).toFixed(0)}% exceeds platform threshold`,
      },
    })
  }
}

export async function recordMessageResponseTime(sellerTenantId: string, hours: number): Promise<void> {
  const profile = await marketplaceDb.marketplaceProfile.findUnique({ where: { tenantId: sellerTenantId } })
  if (!profile) return
  const count = profile.completedOrderCount + profile.ratingCount
  const nextAvg =
    count <= 0 ? hours : (profile.avgResponseTimeHours * count + hours) / (count + 1)
  await marketplaceDb.marketplaceProfile.update({
    where: { tenantId: sellerTenantId },
    data: { avgResponseTimeHours: nextAvg },
  })
}
