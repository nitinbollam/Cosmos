import { marketplaceDb } from './db'
import { computeMarketplaceCommission, computeMarketplaceTransferCents } from './marketplace-constants'

export type SellerAnalyticsPeriod = 7 | 30 | 90 | 365

export type SellerAnalyticsSummary = {
  liveListings: number
  soldListings: number
  pendingReviewListings: number
  endedListings: number
  fixedListings: number
  auctionListings: number
  completedSales: number
  openFulfillment: number
  pendingPayment: number
  cancelledOrders: number
  disputedOrders: number
  grossRevenueCents: number
  netRevenueCents: number
  commissionCents: number
  escrowHeldCents: number
  periodGrossRevenueCents: number
  periodNetRevenueCents: number
  periodCompletedSales: number
  avgOrderValueCents: number
  sellThroughRate: number
  ratingAvg: number
  ratingCount: number
  avgResponseTimeHours: number
}

export type SellerRevenuePoint = {
  date: string
  grossCents: number
  netCents: number
  orders: number
}

export type SellerAnalyticsResponse = {
  periodDays: SellerAnalyticsPeriod
  summary: SellerAnalyticsSummary
  revenueSeries: SellerRevenuePoint[]
  ordersByStatus: Array<{ status: string; count: number }>
  salesByCategory: Array<{ category: string; orders: number; revenueCents: number }>
  salesByListingType: Array<{ listingType: string; orders: number; revenueCents: number }>
  topListings: Array<{
    listingId: string
    title: string
    listingType: string
    orders: number
    revenueCents: number
  }>
  recentSales: Array<{
    orderId: string
    listingTitle: string
    agreedPriceCents: number
    netCents: number
    orderStatus: string
    createdAt: string
  }>
  recentRatings: Array<{ stars: number; comment: string | null; createdAt: string }>
}

const ALLOWED_PERIODS: SellerAnalyticsPeriod[] = [7, 30, 90, 365]

export function clampAnalyticsDays(days: number | undefined): SellerAnalyticsPeriod {
  if (days && ALLOWED_PERIODS.includes(days as SellerAnalyticsPeriod)) {
    return days as SellerAnalyticsPeriod
  }
  return 30
}

export function startOfUtcDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

type OrderForSeries = {
  createdAt: Date
  agreedPriceCents: number
  listingType: 'FIXED' | 'AUCTION'
  orderStatus: string
}

export function buildRevenueSeries(orders: OrderForSeries[], periodDays: number): SellerRevenuePoint[] {
  const end = new Date()
  const start = new Date(end)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - (periodDays - 1))

  const buckets = new Map<string, SellerRevenuePoint>()
  for (let i = 0; i < periodDays; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    const date = startOfUtcDay(d)
    buckets.set(date, { date, grossCents: 0, netCents: 0, orders: 0 })
  }

  for (const order of orders) {
    if (order.orderStatus !== 'COMPLETED') continue
    const key = startOfUtcDay(order.createdAt)
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.grossCents += order.agreedPriceCents
    bucket.netCents += computeMarketplaceTransferCents(order.agreedPriceCents, order.listingType)
    bucket.orders += 1
  }

  return [...buckets.values()]
}

function aggregateByKey<T extends string>(
  rows: Array<{ key: T; revenueCents: number }>,
): Array<{ key: T; orders: number; revenueCents: number }> {
  const map = new Map<T, { orders: number; revenueCents: number }>()
  for (const row of rows) {
    const prev = map.get(row.key) ?? { orders: 0, revenueCents: 0 }
    prev.orders += 1
    prev.revenueCents += row.revenueCents
    map.set(row.key, prev)
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
}

export async function getSellerAnalytics(
  tenantId: string,
  days?: number,
): Promise<SellerAnalyticsResponse> {
  const periodDays = clampAnalyticsDays(days)
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  since.setUTCDate(since.getUTCDate() - (periodDays - 1))

  const [profile, listings, orders, ratings] = await Promise.all([
    marketplaceDb.marketplaceProfile.findUnique({ where: { tenantId } }),
    marketplaceDb.marketplaceListing.findMany({
      where: { sellerTenantId: tenantId },
      select: { id: true, title: true, status: true, listingType: true, category: true },
    }),
    marketplaceDb.marketplaceOrder.findMany({
      where: { sellerTenantId: tenantId },
      include: { listing: { select: { title: true, listingType: true, category: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    marketplaceDb.marketplaceRating.findMany({
      where: { ratedTenantId: tenantId },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { stars: true, comment: true, createdAt: true },
    }),
  ])

  const completedOrders = orders.filter((o) => o.orderStatus === 'COMPLETED')
  const periodCompleted = completedOrders.filter((o) => o.createdAt >= since)

  const grossRevenueCents = completedOrders.reduce((sum, o) => sum + o.agreedPriceCents, 0)
  const commissionCents = completedOrders.reduce(
    (sum, o) => sum + computeMarketplaceCommission(o.agreedPriceCents, o.listing.listingType),
    0,
  )
  const netRevenueCents = grossRevenueCents - commissionCents

  const periodGrossRevenueCents = periodCompleted.reduce((sum, o) => sum + o.agreedPriceCents, 0)
  const periodNetRevenueCents = periodCompleted.reduce(
    (sum, o) => sum + computeMarketplaceTransferCents(o.agreedPriceCents, o.listing.listingType),
    0,
  )

  const escrowHeldCents = orders
    .filter(
      (o) =>
        o.paymentStatus === 'ESCROW_HELD' &&
        !['COMPLETED', 'CANCELLED'].includes(o.orderStatus),
    )
    .reduce((sum, o) => sum + computeMarketplaceTransferCents(o.agreedPriceCents, o.listing.listingType), 0)

  const liveListings = listings.filter((l) => l.status === 'LIVE').length
  const soldListings = listings.filter((l) => l.status === 'SOLD').length
  const endedListings = listings.filter((l) => l.status === 'ENDED').length
  const pendingReviewListings = listings.filter((l) => l.status === 'PENDING_REVIEW').length
  const fixedListings = listings.filter((l) => l.listingType === 'FIXED').length
  const auctionListings = listings.filter((l) => l.listingType === 'AUCTION').length

  const sellThroughDenominator = liveListings + soldListings + endedListings
  const sellThroughRate =
    sellThroughDenominator > 0 ? Math.round((soldListings / sellThroughDenominator) * 100) : 0

  const statusCounts = new Map<string, number>()
  for (const order of orders) {
    statusCounts.set(order.orderStatus, (statusCounts.get(order.orderStatus) ?? 0) + 1)
  }

  const completedForAgg = completedOrders.map((o) => ({
    category: o.listing.category,
    listingType: o.listing.listingType,
    listingId: o.listingId,
    title: o.listing.title,
    revenueCents: o.agreedPriceCents,
  }))

  const salesByCategory = aggregateByKey(
    completedForAgg.map((r) => ({ key: r.category, revenueCents: r.revenueCents })),
  ).map(({ key, orders: count, revenueCents }) => ({ category: key, orders: count, revenueCents }))

  const salesByListingType = aggregateByKey(
    completedForAgg.map((r) => ({ key: r.listingType, revenueCents: r.revenueCents })),
  ).map(({ key, orders: count, revenueCents }) => ({ listingType: key, orders: count, revenueCents }))

  const topListings = aggregateByKey(
    completedForAgg.map((r) => ({ key: r.listingId, revenueCents: r.revenueCents })),
  )
    .slice(0, 5)
    .map(({ key, orders: count, revenueCents }) => {
      const listing = listings.find((l) => l.id === key)
      return {
        listingId: key,
        title: listing?.title ?? 'Listing',
        listingType: listing?.listingType ?? 'FIXED',
        orders: count,
        revenueCents,
      }
    })

  const revenueSeries = buildRevenueSeries(
    orders.map((o) => ({
      createdAt: o.createdAt,
      agreedPriceCents: o.agreedPriceCents,
      listingType: o.listing.listingType,
      orderStatus: o.orderStatus,
    })),
    periodDays,
  )

  return {
    periodDays,
    summary: {
      liveListings,
      soldListings,
      pendingReviewListings,
      endedListings,
      fixedListings,
      auctionListings,
      completedSales: completedOrders.length,
      openFulfillment: orders.filter((o) =>
        ['PAYMENT_HELD', 'IN_FULFILLMENT', 'DELIVERED'].includes(o.orderStatus),
      ).length,
      pendingPayment: orders.filter((o) => o.orderStatus === 'PENDING_PAYMENT').length,
      cancelledOrders: orders.filter((o) => o.orderStatus === 'CANCELLED').length,
      disputedOrders: orders.filter((o) => o.orderStatus === 'DISPUTED').length,
      grossRevenueCents,
      netRevenueCents,
      commissionCents,
      escrowHeldCents,
      periodGrossRevenueCents,
      periodNetRevenueCents,
      periodCompletedSales: periodCompleted.length,
      avgOrderValueCents:
        completedOrders.length > 0 ? Math.round(grossRevenueCents / completedOrders.length) : 0,
      sellThroughRate,
      ratingAvg: profile?.ratingAvg ?? 0,
      ratingCount: profile?.ratingCount ?? 0,
      avgResponseTimeHours: profile?.avgResponseTimeHours ?? 0,
    },
    revenueSeries,
    ordersByStatus: [...statusCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    salesByCategory,
    salesByListingType,
    topListings,
    recentSales: orders.slice(0, 8).map((o) => ({
      orderId: o.id,
      listingTitle: o.listing.title,
      agreedPriceCents: o.agreedPriceCents,
      netCents: computeMarketplaceTransferCents(o.agreedPriceCents, o.listing.listingType),
      orderStatus: o.orderStatus,
      createdAt: o.createdAt.toISOString(),
    })),
    recentRatings: ratings.map((r) => ({
      stars: r.stars,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
    })),
  }
}
