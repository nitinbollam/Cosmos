import { inventoryDb } from './db'
import * as inv from './inventory'
import { ApiError } from './session'

export function marketplaceListingReservationOrderId(listingId: string): string {
  return `mp-listing-${listingId}`
}

export async function getDefaultSellerWarehouseId(tenantId: string): Promise<string> {
  const wh = await inventoryDb.warehouse.findFirst({
    where: { tenantId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  })
  if (!wh) throw new ApiError(400, 'Seller needs an active warehouse before listing inventory')
  return wh.id
}

export async function assertSkuAvailableForListing(
  tenantId: string,
  skuId: string,
  quantity: number,
): Promise<{ warehouseId: string; available: number }> {
  const warehouseId = await getDefaultSellerWarehouseId(tenantId)
  const level = await inventoryDb.stockLevel.findFirst({
    where: { tenantId, skuId, warehouseId, batchId: '' },
  })
  const available = level?.quantityAvailable ?? 0
  if (available < quantity) {
    throw new ApiError(400, `Insufficient inventory: ${available} available, ${quantity} requested`)
  }
  return { warehouseId, available }
}

export async function reserveListingInventory(
  sellerTenantId: string,
  listingId: string,
  skuId: string,
  quantity: number,
): Promise<{ reservationId: string; warehouseId: string }> {
  const { warehouseId } = await assertSkuAvailableForListing(sellerTenantId, skuId, quantity)
  const reservationId = await inv.reserveStock(sellerTenantId, {
    skuId,
    warehouseId,
    quantity,
    orderId: marketplaceListingReservationOrderId(listingId),
    correlationId: listingId,
  })
  return { reservationId, warehouseId }
}

export async function releaseListingInventory(
  sellerTenantId: string,
  reservationId: string | null | undefined,
): Promise<void> {
  if (!reservationId) return
  await inv.releaseReservation(sellerTenantId, reservationId)
}

/** Commit seller on-hand stock when a marketplace order is paid. */
export async function commitMarketplaceSaleInventory(
  sellerTenantId: string,
  listingId: string,
  skuId: string,
  warehouseId: string,
  quantity: number,
): Promise<void> {
  await inv.commitShipmentForOrder(sellerTenantId, marketplaceListingReservationOrderId(listingId), 'marketplace', [
    { skuId, warehouseId, quantity },
  ])
}

/** Re-reserve remaining listing quantity after a partial sale. */
export async function refreshListingReservation(
  sellerTenantId: string,
  listingId: string,
  skuId: string,
  remainingQty: number,
): Promise<{ reservationId: string; warehouseId: string } | null> {
  if (remainingQty <= 0) return null
  return reserveListingInventory(sellerTenantId, listingId, skuId, remainingQty)
}

export async function fulfillMarketplaceInventoryOnPayment(orderId: string): Promise<void> {
  const { marketplaceDb } = await import('./db')
  const order = await marketplaceDb.marketplaceOrder.findUnique({
    where: { id: orderId },
    include: { listing: true },
  })
  if (!order?.listing) return
  const { sellerTenantId, listing } = order
  const warehouseId = listing.sellerWarehouseId ?? (await getDefaultSellerWarehouseId(sellerTenantId))
  await commitMarketplaceSaleInventory(
    sellerTenantId,
    listing.id,
    listing.sourceSkuId,
    warehouseId,
    order.quantity,
  )
  if (listing.status === 'LIVE' && listing.quantity > 0) {
    const next = await refreshListingReservation(
      sellerTenantId,
      listing.id,
      listing.sourceSkuId,
      listing.quantity,
    )
    if (next) {
      await marketplaceDb.marketplaceListing.update({
        where: { id: listing.id },
        data: {
          inventoryReservationId: next.reservationId,
          sellerWarehouseId: next.warehouseId,
        },
      })
    }
  } else {
    await marketplaceDb.marketplaceListing.update({
      where: { id: listing.id },
      data: { inventoryReservationId: null },
    })
  }
}
