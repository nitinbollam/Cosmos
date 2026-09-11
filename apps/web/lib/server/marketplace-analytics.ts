import { marketplaceDb } from './db'

export async function getSellerAnalytics(tenantId: string) {
  const [liveListings, soldListings, sales, openOrders, avgRating] = await Promise.all([
    marketplaceDb.marketplaceListing.count({ where: { sellerTenantId: tenantId, status: 'LIVE' } }),
    marketplaceDb.marketplaceListing.count({ where: { sellerTenantId: tenantId, status: 'SOLD' } }),
    marketplaceDb.marketplaceOrder.count({
      where: { sellerTenantId: tenantId, orderStatus: 'COMPLETED' },
    }),
    marketplaceDb.marketplaceOrder.count({
      where: { sellerTenantId: tenantId, orderStatus: { in: ['PAYMENT_HELD', 'IN_FULFILLMENT', 'DELIVERED'] } },
    }),
    marketplaceDb.marketplaceProfile.findUnique({ where: { tenantId } }),
  ])

  const revenue = await marketplaceDb.marketplaceOrder.aggregate({
    where: { sellerTenantId: tenantId, orderStatus: 'COMPLETED' },
    _sum: { agreedPriceCents: true },
  })

  return {
    liveListings,
    soldListings,
    completedSales: sales,
    openFulfillment: openOrders,
    grossRevenueCents: revenue._sum.agreedPriceCents ?? 0,
    ratingAvg: avgRating?.ratingAvg ?? 0,
    ratingCount: avgRating?.ratingCount ?? 0,
    avgResponseTimeHours: avgRating?.avgResponseTimeHours ?? 0,
  }
}
