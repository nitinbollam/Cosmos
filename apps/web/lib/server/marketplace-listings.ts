import type { SKU } from '@/generated/prisma-inventory'
import { marketplaceDb, tenantDb } from './db'
import * as inv from './inventory'
import { MARKETPLACE_ALLOWED_CATEGORIES, MARKETPLACE_MIN_TENANT_TENURE_DAYS } from './marketplace-constants'
import { notifyMatchingSavedSearches } from './marketplace-saved-searches'
import { assertSellerCanList } from './marketplace-trust'
import { closeExpiredAuctions, reserveMet } from './marketplace-auctions'
import { getOrCreateMarketplaceProfile, toPublicProfile } from './marketplace-profiles'
import { parsePhotoUrls, redactCounterpartyPayload } from './marketplace-privacy'
import { ApiError } from './session'

export type SkuListabilityInput = Pick<
  SKU,
  'isTobacco' | 'isAlcohol' | 'ageRestricted' | 'isRegulated' | 'category'
>

export type PublicMarketplaceListing = {
  id: string
  title: string
  description: string | null
  listingType: 'FIXED' | 'AUCTION'
  priceCents: number
  quantity: number
  category: string
  subcategory: string | null
  photoUrls: string[]
  status: string
  seller: ReturnType<typeof toPublicProfile>
  createdAt: string
  startingPriceCents?: number
  currentHighBidCents?: number | null
  endsAt?: string | null
  reserveNotMet?: boolean
  auctionDurationDays?: number | null
}

export { redactCounterpartyPayload } from './marketplace-privacy'

export function categoryIsAllowed(category: string): boolean {
  const normalized = category.trim().toLowerCase()
  return MARKETPLACE_ALLOWED_CATEGORIES.some((c) => c.toLowerCase() === normalized)
}

/** Compliance gate — allowlist + regulated flags. Called before any listing create/update. */
export function assertListableSku(sku: SkuListabilityInput): void {
  if (sku.isTobacco || sku.isAlcohol || sku.ageRestricted || sku.isRegulated) {
    throw new ApiError(400, 'Regulated SKUs cannot be listed on the marketplace')
  }
  if (!categoryIsAllowed(sku.category)) {
    throw new ApiError(
      400,
      `Category "${sku.category}" is not eligible for marketplace listing. Allowed categories: ${MARKETPLACE_ALLOWED_CATEGORIES.join(', ')}`,
    )
  }
}

export { parsePhotoUrls } from './marketplace-privacy'

function listingSnapshotFromSku(sku: SKU, description?: string) {
  assertListableSku(sku)
  return {
    sourceSkuId: sku.id,
    title: sku.name,
    description: description?.trim() || sku.description || null,
    category: sku.category,
    subcategory: sku.subcategory,
    photoUrlsJson: JSON.stringify([]),
  }
}

export async function toPublicListing(listing: {
  id: string
  sellerTenantId: string
  title: string
  description: string | null
  listingType: 'FIXED' | 'AUCTION'
  priceCents: number
  quantity: number
  category: string
  subcategory: string | null
  photoUrlsJson: string
  status: string
  createdAt: Date
  reservePriceCents?: number | null
  currentHighBidCents?: number | null
  endsAt?: Date | null
  auctionDurationDays?: number | null
}): Promise<PublicMarketplaceListing> {
  const profile = await getOrCreateMarketplaceProfile(listing.sellerTenantId)
  const isAuction = listing.listingType === 'AUCTION'
  const hasReserve = isAuction && listing.reservePriceCents != null && listing.reservePriceCents > 0
  return redactCounterpartyPayload({
    id: listing.id,
    title: listing.title,
    description: listing.description,
    listingType: listing.listingType,
    priceCents: listing.priceCents,
    quantity: listing.quantity,
    category: listing.category,
    subcategory: listing.subcategory,
    photoUrls: parsePhotoUrls(listing.photoUrlsJson),
    status: listing.status,
    seller: toPublicProfile(profile),
    createdAt: listing.createdAt.toISOString(),
    ...(isAuction
      ? {
          startingPriceCents: listing.priceCents,
          currentHighBidCents: listing.currentHighBidCents ?? null,
          endsAt: listing.endsAt?.toISOString() ?? null,
          auctionDurationDays: listing.auctionDurationDays ?? null,
          reserveNotMet: hasReserve && !reserveMet(listing.currentHighBidCents ?? null, listing.reservePriceCents ?? null),
        }
      : {}),
  })
}

export async function createListing(
  tenantId: string,
  userId: string,
  dto: {
    skuId: string
    priceCents: number
    quantity: number
    description?: string
    photoUrls?: string[]
    listingType?: 'FIXED' | 'AUCTION'
    reservePriceCents?: number
    auctionDurationDays?: number
  },
) {
  if (dto.priceCents < 1) throw new ApiError(400, 'priceCents must be positive')
  const listingType = dto.listingType ?? 'FIXED'
  const quantity = listingType === 'AUCTION' ? 1 : dto.quantity
  if (quantity < 1) throw new ApiError(400, 'quantity must be at least 1')

  if (listingType === 'AUCTION') {
    const { validateAuctionDurationDays } = await import('./marketplace-auctions')
    validateAuctionDurationDays(dto.auctionDurationDays ?? 7)
    if (dto.reservePriceCents != null && dto.reservePriceCents > 0 && dto.reservePriceCents < dto.priceCents) {
      throw new ApiError(400, 'reservePriceCents must be at least the starting price')
    }
  }

  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (org) {
    const tenureDays = (Date.now() - org.createdAt.getTime()) / 86400000
    if (tenureDays < MARKETPLACE_MIN_TENANT_TENURE_DAYS) {
      throw new ApiError(
        403,
        `Marketplace listing requires at least ${MARKETPLACE_MIN_TENANT_TENURE_DAYS} days on Pleros`,
      )
    }
  }

  await assertSellerCanList(tenantId)
  await getOrCreateMarketplaceProfile(tenantId)
  const sku = await inv.findSkuById(tenantId, dto.skuId)
  const snapshot = listingSnapshotFromSku(sku, dto.description)
  const { assertSkuAvailableForListing } = await import('./marketplace-inventory')
  await assertSkuAvailableForListing(tenantId, dto.skuId, quantity)

  const listing = await marketplaceDb.marketplaceListing.create({
    data: {
      sellerTenantId: tenantId,
      ...snapshot,
      listingType,
      priceCents: dto.priceCents,
      quantity,
      reservePriceCents: listingType === 'AUCTION' ? (dto.reservePriceCents ?? null) : null,
      auctionDurationDays: listingType === 'AUCTION' ? (dto.auctionDurationDays ?? 7) : null,
      photoUrlsJson: JSON.stringify(dto.photoUrls ?? []),
      status: 'PENDING_REVIEW',
    },
  })

  return toPublicListing(listing)
}

export async function listLiveListings(filters?: { category?: string; search?: string }) {
  await closeExpiredAuctions()
  const rows = await marketplaceDb.marketplaceListing.findMany({
    where: {
      status: 'LIVE',
      ...(filters?.category ? { category: filters.category } : {}),
      ...(filters?.search
        ? {
            OR: [{ title: { contains: filters.search } }, { description: { contains: filters.search } }],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return Promise.all(rows.map((r) => toPublicListing(r)))
}

export async function listSellerListings(tenantId: string) {
  const rows = await marketplaceDb.marketplaceListing.findMany({
    where: { sellerTenantId: tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return Promise.all(rows.map((r) => toPublicListing(r)))
}

export async function listPendingReviewListings() {
  const rows = await marketplaceDb.marketplaceListing.findMany({
    where: { status: 'PENDING_REVIEW' },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })
  return Promise.all(rows.map((r) => toPublicListing(r)))
}

export async function getPublicListing(listingId: string) {
  const listing = await marketplaceDb.marketplaceListing.findFirst({
    where: { id: listingId, status: { in: ['LIVE', 'SOLD', 'ENDED'] } },
  })
  if (!listing) throw new ApiError(404, 'Listing not found')
  if (listing.listingType === 'AUCTION') {
    const { getAuctionDetail } = await import('./marketplace-auctions')
    return getAuctionDetail(listingId)
  }
  return toPublicListing(listing)
}

export async function approveListing(listingId: string, reviewerUserId: string) {
  const listing = await marketplaceDb.marketplaceListing.findUnique({ where: { id: listingId } })
  if (!listing) throw new ApiError(404, 'Listing not found')
  if (listing.status !== 'PENDING_REVIEW') throw new ApiError(400, 'Listing is not pending review')

  const endsAt =
    listing.listingType === 'AUCTION'
      ? (() => {
          const d = new Date()
          d.setDate(d.getDate() + (listing.auctionDurationDays ?? 7))
          return d
        })()
      : null

  const { reserveListingInventory } = await import('./marketplace-inventory')
  const reserved = await reserveListingInventory(
    listing.sellerTenantId,
    listing.id,
    listing.sourceSkuId,
    listing.quantity,
  )

  const updated = await marketplaceDb.marketplaceListing.update({
    where: { id: listingId },
    data: {
      status: 'LIVE',
      reviewedByUserId: reviewerUserId,
      reviewedAt: new Date(),
      rejectionReason: null,
      inventoryReservationId: reserved.reservationId,
      sellerWarehouseId: reserved.warehouseId,
      ...(endsAt ? { endsAt } : {}),
    },
  })
  await notifyMatchingSavedSearches({
    title: updated.title,
    category: updated.category,
    description: updated.description,
  })
  return toPublicListing(updated)
}

export async function rejectListing(listingId: string, reviewerUserId: string, reason: string) {
  const listing = await marketplaceDb.marketplaceListing.findUnique({ where: { id: listingId } })
  if (!listing) throw new ApiError(404, 'Listing not found')
  if (listing.status !== 'PENDING_REVIEW') throw new ApiError(400, 'Listing is not pending review')

  const { releaseListingInventory } = await import('./marketplace-inventory')
  await releaseListingInventory(listing.sellerTenantId, listing.inventoryReservationId)

  const updated = await marketplaceDb.marketplaceListing.update({
    where: { id: listingId },
    data: {
      status: 'REMOVED',
      reviewedByUserId: reviewerUserId,
      reviewedAt: new Date(),
      rejectionReason: reason.trim() || 'Rejected by admin',
      inventoryReservationId: null,
    },
  })
  return toPublicListing(updated)
}

export async function removeListing(tenantId: string, listingId: string) {
  const listing = await marketplaceDb.marketplaceListing.findFirst({
    where: { id: listingId, sellerTenantId: tenantId },
  })
  if (!listing) throw new ApiError(404, 'Listing not found')
  if (listing.status === 'SOLD') throw new ApiError(400, 'Sold listings cannot be removed')

  const { releaseListingInventory } = await import('./marketplace-inventory')
  await releaseListingInventory(tenantId, listing.inventoryReservationId)

  const updated = await marketplaceDb.marketplaceListing.update({
    where: { id: listingId },
    data: { status: 'REMOVED', inventoryReservationId: null },
  })
  return toPublicListing(updated)
}
