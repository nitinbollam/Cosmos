import { marketplaceDb } from './db'
import { MARKETPLACE_ESCROW_HOLD_DAYS, computeMarketplaceCommission } from './marketplace-constants'
import {
  captureMarketplacePaymentIntent,
  createMarketplacePaymentIntent,
  transferMarketplaceEscrowToSeller,
} from './marketplace-payments'
import { incrementCompletedOrders } from './marketplace-profiles'
import { requireStripeConnectContext } from './tenant-stripe-connect'
import { ApiError } from './session'

export type PublicMarketplaceOrder = {
  id: string
  listingId: string
  agreedPriceCents: number
  merchandiseSubtotalCents: number
  taxAmountCents: number
  taxJurisdiction: string | null
  quantity: number
  orderStatus: string
  paymentStatus: string
  kalafleetShipmentRef: string | null
  trackingOnly: boolean
  createdAt: string
}

function escrowReleaseDate(from: Date): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + MARKETPLACE_ESCROW_HOLD_DAYS)
  return d
}

export { computeMarketplaceCommission }

export function toPublicOrder(order: {
  id: string
  listingId: string
  agreedPriceCents: number
  merchandiseSubtotalCents?: number
  taxAmountCents?: number
  taxJurisdiction?: string | null
  quantity: number
  orderStatus: string
  paymentStatus: string
  kalafleetShipmentRef: string | null
  createdAt: Date
}): PublicMarketplaceOrder {
  return {
    id: order.id,
    listingId: order.listingId,
    agreedPriceCents: order.agreedPriceCents,
    merchandiseSubtotalCents: order.merchandiseSubtotalCents ?? order.agreedPriceCents,
    taxAmountCents: order.taxAmountCents ?? 0,
    taxJurisdiction: order.taxJurisdiction ?? null,
    quantity: order.quantity,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    kalafleetShipmentRef: order.kalafleetShipmentRef,
    trackingOnly: true,
    createdAt: order.createdAt.toISOString(),
  }
}

export async function createMarketplaceOrder(
  buyerTenantId: string,
  listingId: string,
  quantity: number,
) {
  if (quantity < 1) throw new ApiError(400, 'quantity must be at least 1')

  const listing = await marketplaceDb.marketplaceListing.findFirst({
    where: { id: listingId, status: 'LIVE', listingType: 'FIXED' },
  })
  if (!listing) throw new ApiError(404, 'Listing not available')
  if (listing.sellerTenantId === buyerTenantId) {
    throw new ApiError(400, 'Cannot purchase your own listing')
  }
  if (quantity > listing.quantity) throw new ApiError(400, 'Insufficient listing quantity')

  await requireStripeConnectContext(listing.sellerTenantId)

  const { buildMarketplaceOrderPricing } = await import('./marketplace-tax')
  const pricing = await buildMarketplaceOrderPricing(buyerTenantId, listing.priceCents, quantity)

  const order = await marketplaceDb.$transaction(async (tx) => {
    const created = await tx.marketplaceOrder.create({
      data: {
        listingId: listing.id,
        buyerTenantId,
        sellerTenantId: listing.sellerTenantId,
        agreedPriceCents: pricing.agreedPriceCents,
        merchandiseSubtotalCents: pricing.merchandiseSubtotalCents,
        taxAmountCents: pricing.taxAmountCents,
        taxRate: pricing.taxRate,
        taxJurisdiction: pricing.taxJurisdiction,
        quantity,
        orderStatus: 'PENDING_PAYMENT',
        paymentStatus: 'PENDING',
      },
    })
    await tx.marketplaceListing.update({
      where: { id: listing.id },
      data: { quantity: { decrement: quantity } },
    })
    if (listing.quantity - quantity <= 0) {
      await tx.marketplaceListing.update({
        where: { id: listing.id },
        data: { status: 'SOLD' },
      })
    }
    return created
  })

  return toPublicOrder(order)
}

export async function startMarketplacePayment(buyerTenantId: string, orderId: string) {
  const order = await marketplaceDb.marketplaceOrder.findFirst({
    where: { id: orderId, buyerTenantId },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.orderStatus !== 'PENDING_PAYMENT') throw new ApiError(400, 'Order is not awaiting payment')

  return createMarketplacePaymentIntent({
    orderId: order.id,
    buyerTenantId: order.buyerTenantId,
    sellerTenantId: order.sellerTenantId,
    amountCents: order.agreedPriceCents,
  })
}

/** Capture platform PaymentIntent and hold in escrow until delivery + hold window. */
export async function confirmMarketplacePayment(
  buyerTenantId: string,
  orderId: string,
  stripePaymentIntentId: string,
) {
  const order = await marketplaceDb.marketplaceOrder.findFirst({
    where: { id: orderId, buyerTenantId },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.orderStatus !== 'PENDING_PAYMENT') throw new ApiError(400, 'Order is not awaiting payment')

  await captureMarketplacePaymentIntent(
    order.id,
    order.buyerTenantId,
    order.sellerTenantId,
    order.agreedPriceCents,
    stripePaymentIntentId,
  )

  const updated = await marketplaceDb.marketplaceOrder.update({
    where: { id: orderId },
    data: {
      stripePaymentIntentId,
      paymentStatus: 'ESCROW_HELD',
      orderStatus: 'PAYMENT_HELD',
    },
  })
  try {
    const { fulfillMarketplaceInventoryOnPayment } = await import('./marketplace-inventory')
    await fulfillMarketplaceInventoryOnPayment(orderId)
  } catch (err) {
    console.error('[marketplace] inventory commit failed', orderId, err)
  }
  try {
    const { createMarketplaceShipmentRequest } = await import('./marketplace-shipping')
    await createMarketplaceShipmentRequest(orderId)
  } catch {
    /* ops can book Kalafleet manually */
  }
  return toPublicOrder(updated)
}

/** Release escrows whose hold window has elapsed (background job). */
export async function releaseDueMarketplaceEscrows(): Promise<number> {
  const due = await marketplaceDb.marketplaceOrder.findMany({
    where: {
      orderStatus: 'DELIVERED',
      paymentStatus: 'ESCROW_HELD',
      escrowReleaseAt: { lte: new Date() },
    },
    include: { dispute: true },
    take: 25,
  })
  let released = 0
  for (const order of due) {
    if (order.dispute?.status === 'OPEN') continue
    try {
      await releaseMarketplaceEscrow(order.id)
      released++
    } catch (err) {
      console.error('[marketplace-jobs] escrow release failed', order.id, err)
    }
  }
  return released
}

/** Ops assigns Kalafleet shipment — books LTL with internal addresses, tracking ref only in UI. */
export async function assignKalafleetShipment(orderId: string, shipmentRef: string) {
  const order = await marketplaceDb.marketplaceOrder.findUnique({ where: { id: orderId } })
  if (!order) throw new ApiError(404, 'Order not found')

  const { bookMarketplaceShipment } = await import('./marketplace-shipping')
  await bookMarketplaceShipment(orderId, shipmentRef)
  const updated = await marketplaceDb.marketplaceOrder.findUnique({ where: { id: orderId } })
  if (!updated) throw new ApiError(404, 'Order not found')
  return toPublicOrder(updated)
}

export async function confirmMarketplaceDelivery(orderId: string) {
  const order = await marketplaceDb.marketplaceOrder.findUnique({
    where: { id: orderId },
    include: { dispute: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.dispute?.status === 'OPEN') throw new ApiError(400, 'Order has an open dispute')

  const now = new Date()
  const updated = await marketplaceDb.marketplaceOrder.update({
    where: { id: orderId },
    data: {
      deliveryConfirmedAt: now,
      escrowReleaseAt: escrowReleaseDate(now),
      orderStatus: 'DELIVERED',
    },
  })
  return toPublicOrder(updated)
}

/** Release escrow to seller Connect account minus platform commission. */
export async function releaseMarketplaceEscrow(orderId: string) {
  const order = await marketplaceDb.marketplaceOrder.findUnique({
    where: { id: orderId },
    include: { dispute: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.dispute?.status === 'OPEN') throw new ApiError(400, 'Escrow held due to open dispute')
  if (order.paymentStatus !== 'ESCROW_HELD') throw new ApiError(400, 'Payment is not in escrow')
  if (!order.escrowReleaseAt || order.escrowReleaseAt > new Date()) {
    throw new ApiError(400, 'Escrow hold period has not elapsed')
  }

  if (!order.stripePaymentIntentId) throw new ApiError(400, 'No payment on record for this order')

  await transferMarketplaceEscrowToSeller({
    orderId: order.id,
    sellerTenantId: order.sellerTenantId,
    grossCents: order.agreedPriceCents,
    stripePaymentIntentId: order.stripePaymentIntentId,
  })

  const updated = await marketplaceDb.marketplaceOrder.update({
    where: { id: orderId },
    data: {
      paymentStatus: 'RELEASED',
      orderStatus: 'COMPLETED',
    },
  })

  await incrementCompletedOrders(order.sellerTenantId)
  await incrementCompletedOrders(order.buyerTenantId)

  return toPublicOrder(updated)
}

export async function listBuyerOrders(tenantId: string) {
  const rows = await marketplaceDb.marketplaceOrder.findMany({
    where: { buyerTenantId: tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return rows.map(toPublicOrder)
}

export async function listSellerOrders(tenantId: string) {
  const rows = await marketplaceDb.marketplaceOrder.findMany({
    where: { sellerTenantId: tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return rows.map(toPublicOrder)
}

export async function openMarketplaceDispute(tenantId: string, orderId: string, notes: string) {
  const order = await marketplaceDb.marketplaceOrder.findFirst({
    where: {
      id: orderId,
      OR: [{ buyerTenantId: tenantId }, { sellerTenantId: tenantId }],
    },
  })
  if (!order) throw new ApiError(404, 'Order not found')

  const existing = await marketplaceDb.marketplaceDispute.findUnique({ where: { orderId } })
  if (existing) throw new ApiError(400, 'Dispute already opened for this order')

  await marketplaceDb.$transaction([
    marketplaceDb.marketplaceDispute.create({
      data: {
        orderId,
        openedByTenantId: tenantId,
        notes: notes.trim() || null,
        status: 'OPEN',
      },
    }),
    marketplaceDb.marketplaceOrder.update({
      where: { id: orderId },
      data: { orderStatus: 'DISPUTED' },
    }),
  ])

  const { checkAndSuspendForDisputes } = await import('./marketplace-trust')
  await checkAndSuspendForDisputes(order.sellerTenantId)

  return { orderId, status: 'OPEN' }
}
