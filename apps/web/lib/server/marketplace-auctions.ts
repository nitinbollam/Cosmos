import { marketplaceDb } from './db'
import {
  MARKETPLACE_AUCTION_ANTI_SNIPE_MINUTES,
  MARKETPLACE_AUCTION_DURATIONS,
} from './marketplace-constants'
import { getDefaultMarketplacePaymentMethod, requireMarketplacePaymentMethod } from './marketplace-buyer-payments'
import { parsePhotoUrls } from './marketplace-privacy'
import { getOrCreateMarketplaceProfile, toPublicProfile } from './marketplace-profiles'
import { redactCounterpartyPayload } from './marketplace-privacy'
import { chargeMarketplaceBuyerOffSession, captureMarketplacePaymentIntent } from './marketplace-payments'
import { notifyAuctionOutbid, notifyAuctionWon, notifyPaymentDue } from './marketplace-notifications'
import { createMarketplaceShipmentRequest } from './marketplace-shipping'
import { applyBuyerStrike } from './marketplace-trust'
import { ApiError } from './session'

/** Standard auction-house style minimum increment based on current price tier. */
export function computeMinBidIncrementCents(currentBidCents: number): number {
  if (currentBidCents < 100) return 5
  if (currentBidCents < 500) return 25
  if (currentBidCents < 2000) return 50
  if (currentBidCents < 10000) return 100
  if (currentBidCents < 50000) return 250
  return 500
}

export function computeMinimumNextBidCents(startingPriceCents: number, currentHighBidCents: number | null): number {
  if (currentHighBidCents == null) return startingPriceCents
  return currentHighBidCents + computeMinBidIncrementCents(currentHighBidCents)
}

export function reserveMet(currentHighBidCents: number | null, reservePriceCents: number | null): boolean {
  if (reservePriceCents == null || reservePriceCents <= 0) return true
  if (currentHighBidCents == null) return false
  return currentHighBidCents >= reservePriceCents
}

export function applyAntiSnipeExtension(endsAt: Date, now = new Date()): Date {
  const windowMs = MARKETPLACE_AUCTION_ANTI_SNIPE_MINUTES * 60 * 1000
  if (endsAt.getTime() - now.getTime() > windowMs) return endsAt
  return new Date(now.getTime() + windowMs)
}

export function validateAuctionDurationDays(days: number): number {
  if (!(MARKETPLACE_AUCTION_DURATIONS as readonly number[]).includes(days)) {
    throw new ApiError(400, `auctionDurationDays must be one of: ${MARKETPLACE_AUCTION_DURATIONS.join(', ')}`)
  }
  return days
}

/** Rank unique bidders by their highest bid (desc). Exported for tests. */
export function rankAuctionCandidates(
  bids: { bidderTenantId: string; amountCents: number }[],
  reservePriceCents: number | null,
): { bidderTenantId: string; amountCents: number }[] {
  const bestByBidder = new Map<string, number>()
  for (const b of bids) {
    const prev = bestByBidder.get(b.bidderTenantId) ?? 0
    if (b.amountCents > prev) bestByBidder.set(b.bidderTenantId, b.amountCents)
  }
  return [...bestByBidder.entries()]
    .map(([bidderTenantId, amountCents]) => ({ bidderTenantId, amountCents }))
    .filter((c) => reserveMet(c.amountCents, reservePriceCents))
    .sort((a, b) => b.amountCents - a.amountCents)
}

async function toPublicBid(bid: { id: string; amountCents: number; createdAt: Date; bidderTenantId: string }) {
  const profile = await getOrCreateMarketplaceProfile(bid.bidderTenantId)
  return redactCounterpartyPayload({
    id: bid.id,
    amountCents: bid.amountCents,
    createdAt: bid.createdAt.toISOString(),
    bidder: toPublicProfile(profile),
  })
}

export async function getAuctionDetail(listingId: string) {
  const listing = await marketplaceDb.marketplaceListing.findFirst({
    where: { id: listingId, listingType: 'AUCTION', status: { in: ['LIVE', 'SOLD', 'ENDED'] } },
    include: { bids: { orderBy: { amountCents: 'desc' }, take: 20 } },
  })
  if (!listing) throw new ApiError(404, 'Auction not found')

  await closeAuctionIfExpired(listingId)

  const refreshed = await marketplaceDb.marketplaceListing.findFirst({
    where: { id: listingId },
    include: { bids: { orderBy: { createdAt: 'desc' }, take: 20 } },
  })
  if (!refreshed) throw new ApiError(404, 'Auction not found')

  const profile = await getOrCreateMarketplaceProfile(refreshed.sellerTenantId)
  const minNextBid = computeMinimumNextBidCents(refreshed.priceCents, refreshed.currentHighBidCents)
  const hasReserve = refreshed.reservePriceCents != null && refreshed.reservePriceCents > 0
  const met = reserveMet(refreshed.currentHighBidCents, refreshed.reservePriceCents)

  return redactCounterpartyPayload({
    id: refreshed.id,
    title: refreshed.title,
    description: refreshed.description,
    listingType: 'AUCTION',
    photoUrls: parsePhotoUrls(refreshed.photoUrlsJson),
    startingPriceCents: refreshed.priceCents,
    currentHighBidCents: refreshed.currentHighBidCents,
    minNextBidCents: refreshed.status === 'LIVE' ? minNextBid : null,
    reserveMet: met,
    reserveNotMet: hasReserve && !met,
    endsAt: refreshed.endsAt?.toISOString() ?? null,
    status: refreshed.status,
    category: refreshed.category,
    seller: toPublicProfile(profile),
    bids: await Promise.all(refreshed.bids.map((b) => toPublicBid(b))),
  })
}

export async function placeBid(bidderTenantId: string, listingId: string, amountCents: number) {
  if (amountCents < 1) throw new ApiError(400, 'Bid amount must be positive')

  await requireMarketplacePaymentMethod(bidderTenantId)

  const listing = await marketplaceDb.marketplaceListing.findFirst({
    where: { id: listingId, listingType: 'AUCTION', status: 'LIVE' },
  })
  if (!listing) throw new ApiError(404, 'Auction not open for bidding')
  if (listing.sellerTenantId === bidderTenantId) {
    throw new ApiError(400, 'Cannot bid on your own auction')
  }
  if (!listing.endsAt || listing.endsAt <= new Date()) {
    await closeAuctionIfExpired(listingId)
    throw new ApiError(400, 'Auction has ended')
  }

  const previousHighBidder = listing.highBidderTenantId
  const previousHigh = listing.currentHighBidCents

  await getOrCreateMarketplaceProfile(bidderTenantId)

  const minBid = computeMinimumNextBidCents(listing.priceCents, listing.currentHighBidCents)
  if (amountCents < minBid) {
    throw new ApiError(400, `Minimum bid is $${(minBid / 100).toFixed(2)}`)
  }

  const newEndsAt = applyAntiSnipeExtension(listing.endsAt)

  const bid = await marketplaceDb.$transaction(async (tx) => {
    const created = await tx.marketplaceBid.create({
      data: { listingId, bidderTenantId, amountCents },
    })
    await tx.marketplaceListing.update({
      where: { id: listingId },
      data: {
        currentHighBidCents: amountCents,
        highBidderTenantId: bidderTenantId,
        endsAt: newEndsAt,
      },
    })
    return created
  })

  if (previousHighBidder && previousHighBidder !== bidderTenantId && previousHigh != null) {
    await notifyAuctionOutbid(previousHighBidder, listing.title, amountCents)
  }

  return toPublicBid(bid)
}

async function tryAutoChargeWinner(
  order: { id: string; buyerTenantId: string; sellerTenantId: string; agreedPriceCents: number },
  listingTitle: string,
): Promise<'paid' | 'pending_auth' | 'failed'> {
  const pm = await getDefaultMarketplacePaymentMethod(order.buyerTenantId)
  if (!pm) {
    await notifyPaymentDue(order.buyerTenantId, order.id, order.agreedPriceCents)
    return 'failed'
  }

  const charge = await chargeMarketplaceBuyerOffSession({
    orderId: order.id,
    buyerTenantId: order.buyerTenantId,
    sellerTenantId: order.sellerTenantId,
    amountCents: order.agreedPriceCents,
    paymentMethodId: pm.stripePaymentMethodId,
    listingType: 'AUCTION',
  })

  if (charge.success) {
    await captureMarketplacePaymentIntent(
      order.id,
      order.buyerTenantId,
      order.sellerTenantId,
      order.agreedPriceCents,
      charge.stripePaymentIntentId,
    )
    await marketplaceDb.marketplaceOrder.update({
      where: { id: order.id },
      data: {
        stripePaymentIntentId: charge.stripePaymentIntentId,
        paymentStatus: 'ESCROW_HELD',
        orderStatus: 'PAYMENT_HELD',
      },
    })
    try {
      const { fulfillMarketplaceInventoryOnPayment } = await import('./marketplace-inventory')
      await fulfillMarketplaceInventoryOnPayment(order.id)
    } catch (err) {
      console.error('[marketplace] auction inventory commit failed', order.id, err)
    }
    try {
      await createMarketplaceShipmentRequest(order.id)
    } catch {
      /* ops can book manually */
    }
    await notifyAuctionWon(order.buyerTenantId, listingTitle, order.agreedPriceCents)
    return 'paid'
  }

  if (charge.requiresAction) {
    await marketplaceDb.marketplaceOrder.update({
      where: { id: order.id },
      data: { stripePaymentIntentId: charge.stripePaymentIntentId, paymentStatus: 'PENDING' },
    })
    await notifyPaymentDue(order.buyerTenantId, order.id, order.agreedPriceCents)
    await notifyAuctionWon(order.buyerTenantId, listingTitle, order.agreedPriceCents)
    return 'pending_auth'
  }

  return 'failed'
}

/** Close expired auction; create order for winner when reserve met. */
export async function closeAuctionIfExpired(listingId: string): Promise<boolean> {
  const listing = await marketplaceDb.marketplaceListing.findFirst({
    where: { id: listingId, listingType: 'AUCTION', status: 'LIVE' },
  })
  if (!listing || !listing.endsAt || listing.endsAt > new Date()) return false
  await finalizeAuction(listingId)
  return true
}

export async function finalizeAuction(listingId: string) {
  const listing = await marketplaceDb.marketplaceListing.findUnique({
    where: { id: listingId },
    include: { bids: true },
  })
  if (!listing || listing.listingType !== 'AUCTION') throw new ApiError(404, 'Auction not found')
  if (listing.status !== 'LIVE') throw new ApiError(400, 'Auction is not live')

  const candidates = rankAuctionCandidates(listing.bids, listing.reservePriceCents)
  if (candidates.length === 0) {
    await marketplaceDb.marketplaceListing.update({
      where: { id: listingId },
      data: { status: 'ENDED' },
    })
    return { listingId, status: 'ENDED' as const, orderId: null }
  }

  for (const candidate of candidates) {
    const { buildMarketplaceOrderPricing } = await import('./marketplace-tax')
    const pricing = await buildMarketplaceOrderPricing(candidate.bidderTenantId, candidate.amountCents, 1)

    const order = await marketplaceDb.$transaction(async (tx) => {
      await tx.marketplaceListing.update({
        where: { id: listingId },
        data: {
          status: 'SOLD',
          quantity: 0,
          highBidderTenantId: candidate.bidderTenantId,
          currentHighBidCents: candidate.amountCents,
        },
      })
      return tx.marketplaceOrder.create({
        data: {
          listingId,
          buyerTenantId: candidate.bidderTenantId,
          sellerTenantId: listing.sellerTenantId,
          agreedPriceCents: pricing.agreedPriceCents,
          merchandiseSubtotalCents: pricing.merchandiseSubtotalCents,
          taxAmountCents: pricing.taxAmountCents,
          taxRate: pricing.taxRate,
          taxJurisdiction: pricing.taxJurisdiction,
          quantity: 1,
          orderStatus: 'PENDING_PAYMENT',
          paymentStatus: 'PENDING',
        },
      })
    })

    const outcome = await tryAutoChargeWinner(order, listing.title)
    if (outcome === 'paid' || outcome === 'pending_auth') {
      return {
        listingId,
        status: 'SOLD' as const,
        orderId: order.id,
        winnerTenantId: candidate.bidderTenantId,
        autoPaid: outcome === 'paid',
      }
    }

    await applyBuyerStrike(candidate.bidderTenantId, 'Auction payment failed at close')
    await marketplaceDb.marketplaceOrder.update({
      where: { id: order.id },
      data: { orderStatus: 'CANCELLED', paymentStatus: 'FAILED' },
    })
    await marketplaceDb.marketplaceListing.update({
      where: { id: listingId },
      data: { status: 'LIVE', highBidderTenantId: null, currentHighBidCents: null },
    })
  }

  await marketplaceDb.marketplaceListing.update({
    where: { id: listingId },
    data: { status: 'ENDED' },
  })
  return { listingId, status: 'ENDED' as const, orderId: null }
}

/** Ops or cron: close all expired live auctions. */
export async function closeExpiredAuctions(): Promise<number> {
  const expired = await marketplaceDb.marketplaceListing.findMany({
    where: {
      listingType: 'AUCTION',
      status: 'LIVE',
      endsAt: { lte: new Date() },
    },
    take: 50,
  })
  for (const row of expired) {
    await finalizeAuction(row.id)
  }
  return expired.length
}
