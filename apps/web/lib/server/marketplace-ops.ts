import { marketplaceDb } from './db'
import { tenantDb } from './db'
import {
  listPendingReviewListings,
  approveListing,
  rejectListing,
} from './marketplace-listings'
import {
  assignKalafleetShipment,
  confirmMarketplaceDelivery,
  releaseMarketplaceEscrow,
  toPublicOrder,
} from './marketplace-orders'

export type OpsMarketplaceOrder = ReturnType<typeof toPublicOrder> & {
  buyerTenantId: string
  sellerTenantId: string
  buyerLabel: string
  sellerLabel: string
  listingTitle: string
  escrowReleaseAt: string | null
  deliveryConfirmedAt: string | null
  disputeStatus: string | null
}

async function tenantLabel(tenantId: string): Promise<string> {
  const org = await tenantDb.tenantOrganization.findUnique({
    where: { id: tenantId },
    select: { displayName: true, slug: true },
  })
  return org?.displayName?.trim() || org?.slug || tenantId
}

async function toOpsOrder(order: {
  id: string
  listingId: string
  buyerTenantId: string
  sellerTenantId: string
  agreedPriceCents: number
  quantity: number
  orderStatus: string
  paymentStatus: string
  kalafleetShipmentRef: string | null
  escrowReleaseAt: Date | null
  deliveryConfirmedAt: Date | null
  createdAt: Date
  dispute?: { status: string } | null
}): Promise<OpsMarketplaceOrder> {
  const listing = await marketplaceDb.marketplaceListing.findUnique({
    where: { id: order.listingId },
    select: { title: true },
  })
  const [buyerLabel, sellerLabel] = await Promise.all([
    tenantLabel(order.buyerTenantId),
    tenantLabel(order.sellerTenantId),
  ])
  return {
    ...toPublicOrder(order),
    buyerTenantId: order.buyerTenantId,
    sellerTenantId: order.sellerTenantId,
    buyerLabel,
    sellerLabel,
    listingTitle: listing?.title ?? '—',
    escrowReleaseAt: order.escrowReleaseAt?.toISOString() ?? null,
    deliveryConfirmedAt: order.deliveryConfirmedAt?.toISOString() ?? null,
    disputeStatus: order.dispute?.status ?? null,
  }
}

export async function listOpsMarketplaceOrders(filter?: {
  queue?: 'fulfillment' | 'delivery' | 'escrow' | 'disputed' | 'all'
}) {
  const queue = filter?.queue ?? 'all'
  const where =
    queue === 'fulfillment'
      ? { orderStatus: { in: ['PAYMENT_HELD' as const, 'IN_FULFILLMENT' as const] } }
      : queue === 'delivery'
        ? { orderStatus: 'IN_FULFILLMENT' as const }
        : queue === 'escrow'
          ? { orderStatus: 'DELIVERED' as const, paymentStatus: 'ESCROW_HELD' as const }
          : queue === 'disputed'
            ? { orderStatus: 'DISPUTED' as const }
            : {}

  const rows = await marketplaceDb.marketplaceOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { dispute: true },
  })
  return Promise.all(rows.map((r) => toOpsOrder(r)))
}

export {
  listPendingReviewListings,
  approveListing,
  rejectListing,
  assignKalafleetShipment,
  confirmMarketplaceDelivery,
  releaseMarketplaceEscrow,
}
