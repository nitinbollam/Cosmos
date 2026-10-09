import type { SalesChannelConnection, SalesChannelType } from '@/generated/prisma-sales-channels'
import { SalesChannelSyncStatus } from '@/generated/prisma-sales-channels'
import type { Order } from '@/generated/prisma-order'
import { salesChannelsDb, inventoryDb } from '../db'
import { encryptSecret } from '../crypto-util'
import { ApiError } from '../session'
import { isChannelEligible } from './eligibility'
import * as crm from '../crm'
import * as inv from '../inventory'
import * as orders from '../orders'

export type ExternalOrderDto = {
  externalOrderId: string
  customer: { name: string; email?: string; phone?: string }
  shippingAddress?: Record<string, unknown>
  lineItems: Array<{
    externalListingId: string
    quantity: number
    unitPrice: number
    title?: string
  }>
  notes?: string
}

const DEBOUNCE_MS = 5000
const pendingSkuPushes = new Map<string, NodeJS.Timeout>()

function sanitizeConnection(row: SalesChannelConnection) {
  const { credentials: _credentials, ...rest } = row
  return rest
}

export async function connectChannel(
  tenantId: string,
  type: SalesChannelType,
  credentials: Record<string, unknown>,
  opts?: { shopDomain?: string | null },
): Promise<SalesChannelConnection> {
  const shopDomain = opts?.shopDomain?.trim().toLowerCase() || null
  const encrypted = encryptSecret(JSON.stringify(credentials))

  const existing = await salesChannelsDb.salesChannelConnection.findFirst({
    where: { tenantId, type, shopDomain },
  })

  if (existing) {
    return salesChannelsDb.salesChannelConnection.update({
      where: { id: existing.id },
      data: { credentials: encrypted, isActive: true },
    })
  }

  return salesChannelsDb.salesChannelConnection.create({
    data: {
      tenantId,
      type,
      shopDomain,
      credentials: encrypted,
    },
  })
}

export async function disconnectChannel(tenantId: string, connectionId: string): Promise<void> {
  const row = await salesChannelsDb.salesChannelConnection.findFirst({
    where: { id: connectionId, tenantId },
  })
  if (!row) throw new ApiError(404, 'Sales channel connection not found')
  await salesChannelsDb.salesChannelConnection.update({
    where: { id: connectionId },
    data: { isActive: false },
  })
}

export async function listConnections(tenantId: string) {
  const rows = await salesChannelsDb.salesChannelConnection.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { listings: true } },
      listings: {
        where: { syncStatus: SalesChannelSyncStatus.ERROR },
        select: { id: true },
      },
    },
  })
  return rows.map((row) => ({
    ...sanitizeConnection(row),
    listingCount: row._count.listings,
    errorCount: row.listings.length,
  }))
}

export async function listConnectionListings(
  tenantId: string,
  connectionId: string,
  opts?: { syncStatus?: SalesChannelSyncStatus },
) {
  const connection = await salesChannelsDb.salesChannelConnection.findFirst({
    where: { id: connectionId, tenantId },
  })
  if (!connection) throw new ApiError(404, 'Sales channel connection not found')

  const listings = await salesChannelsDb.salesChannelListing.findMany({
    where: {
      tenantId,
      connectionId,
      ...(opts?.syncStatus ? { syncStatus: opts.syncStatus } : {}),
    },
    orderBy: { lastSyncedAt: 'desc' },
  })

  const skuIds = listings.map((l) => l.skuId)
  const skus =
    skuIds.length > 0
      ? await inventoryDb.sKU.findMany({
          where: { tenantId, id: { in: skuIds } },
          select: { id: true, code: true, name: true, price: true, isActive: true },
        })
      : []
  const skuMap = new Map(skus.map((s) => [s.id, s]))

  return listings.map((listing) => ({
    ...listing,
    sku: skuMap.get(listing.skuId) ?? null,
  }))
}

export async function retryListing(tenantId: string, listingId: string) {
  const listing = await salesChannelsDb.salesChannelListing.findFirst({
    where: { id: listingId, tenantId },
  })
  if (!listing) throw new ApiError(404, 'Listing not found')
  return salesChannelsDb.salesChannelListing.update({
    where: { id: listingId },
    data: { syncStatus: SalesChannelSyncStatus.PENDING, lastError: null },
  })
}

export async function queuePriceOrQuantityPush(tenantId: string, skuId: string): Promise<void> {
  const key = `${tenantId}:${skuId}`
  const existing = pendingSkuPushes.get(key)
  if (existing) clearTimeout(existing)

  const timeout = setTimeout(() => {
    pendingSkuPushes.delete(key)
    void markListingsPending(tenantId, skuId).catch((err) =>
      console.error(`[sales-channels] mark pending failed for ${skuId}:`, err),
    )
  }, DEBOUNCE_MS)

  pendingSkuPushes.set(key, timeout)
}

async function markListingsPending(tenantId: string, skuId: string): Promise<void> {
  await salesChannelsDb.salesChannelListing.updateMany({
    where: {
      tenantId,
      skuId,
      syncStatus: { not: SalesChannelSyncStatus.PENDING },
    },
    data: { syncStatus: SalesChannelSyncStatus.PENDING },
  })
}

export async function flushPendingPushes(connectionId: string): Promise<{ pushed: number; failed: number }> {
  const connection = await salesChannelsDb.salesChannelConnection.findFirst({
    where: { id: connectionId, isActive: true },
  })
  if (!connection) return { pushed: 0, failed: 0 }

  const pending = await salesChannelsDb.salesChannelListing.findMany({
    where: { connectionId, syncStatus: SalesChannelSyncStatus.PENDING },
    take: 50,
  })
  if (pending.length === 0) return { pushed: 0, failed: 0 }

  let pushed = 0
  let failed = 0

  for (const listing of pending) {
    const sku = await inventoryDb.sKU.findFirst({ where: { id: listing.skuId, tenantId: connection.tenantId } })
    if (!sku || !isChannelEligible(sku, connection.type)) {
      await salesChannelsDb.salesChannelListing.update({
        where: { id: listing.id },
        data: {
          syncStatus: SalesChannelSyncStatus.ERROR,
          lastError: 'SKU inactive or ineligible for this channel',
        },
      })
      failed++
      continue
    }

    const stockLevels = await inventoryDb.stockLevel.findMany({
      where: { tenantId: connection.tenantId, skuId: listing.skuId },
    })
    const stockLevel = stockLevels.reduce((sum, row) => sum + row.quantityAvailable, 0)

    try {
      const result = await dispatchSkuPush(connection, sku, stockLevel)
      await salesChannelsDb.salesChannelListing.update({
        where: { id: listing.id },
        data: {
          externalListingId: result.externalListingId,
          syncStatus: SalesChannelSyncStatus.SYNCED,
          lastSyncedAt: new Date(),
          lastError: null,
        },
      })
      pushed++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Push failed'
      await salesChannelsDb.salesChannelListing.update({
        where: { id: listing.id },
        data: {
          syncStatus: SalesChannelSyncStatus.ERROR,
          lastError: message.slice(0, 500),
        },
      })
      failed++
    }
  }

  if (pushed > 0 || failed > 0) {
    await salesChannelsDb.salesChannelConnection.update({
      where: { id: connectionId },
      data: { lastSyncedAt: new Date() },
    })
  }

  return { pushed, failed }
}

async function dispatchSkuPush(
  connection: SalesChannelConnection,
  sku: Awaited<ReturnType<typeof inventoryDb.sKU.findFirst>>,
  stockLevel: number,
): Promise<{ externalListingId: string }> {
  if (!sku) throw new ApiError(404, 'SKU not found')

  switch (connection.type) {
    case 'SHOPIFY': {
      const shopify = await import('./shopify')
      return shopify.pushSkuToShopify(connection, sku, stockLevel)
    }
    default:
      throw new ApiError(501, `${connection.type} adapter is not implemented yet`)
  }
}

export async function ensureListingForSku(
  tenantId: string,
  connectionId: string,
  skuId: string,
): Promise<void> {
  await salesChannelsDb.salesChannelListing.upsert({
    where: { connectionId_skuId: { connectionId, skuId } },
    create: { tenantId, connectionId, skuId, syncStatus: SalesChannelSyncStatus.PENDING },
    update: { syncStatus: SalesChannelSyncStatus.PENDING, lastError: null },
  })
}

export async function queueAllEligibleSkus(tenantId: string, connectionId: string): Promise<number> {
  const connection = await salesChannelsDb.salesChannelConnection.findFirst({
    where: { id: connectionId, tenantId, isActive: true },
  })
  if (!connection) throw new ApiError(404, 'Sales channel connection not found')

  const skus = await inventoryDb.sKU.findMany({ where: { tenantId, isActive: true } })
  let queued = 0
  for (const sku of skus) {
    if (!isChannelEligible(sku, connection.type)) continue
    await ensureListingForSku(tenantId, connectionId, sku.id)
    queued++
  }
  return queued
}

export async function flushAllActiveConnections(): Promise<{ connections: number; pushed: number; failed: number }> {
  const connections = await salesChannelsDb.salesChannelConnection.findMany({
    where: { isActive: true },
    select: { id: true },
  })
  let pushed = 0
  let failed = 0
  for (const connection of connections) {
    const result = await flushPendingPushes(connection.id)
    pushed += result.pushed
    failed += result.failed
  }
  return { connections: connections.length, pushed, failed }
}

async function resolveOrCreateChannelCustomer(
  tenantId: string,
  connectionId: string,
  customer: ExternalOrderDto['customer'],
) {
  const externalRef = `sales-channel:${connectionId}:${customer.email?.trim().toLowerCase() || customer.name.trim()}`
  const existing = await crm.findCustomerByExternalRef(tenantId, externalRef)
  if (existing) return existing

  if (customer.email?.trim()) {
    const byEmail = await crm.findCustomerByEmail(tenantId, customer.email)
    if (byEmail) return byEmail
  }

  return crm.createCustomer(tenantId, {
    name: customer.name.trim() || 'Shopify Customer',
    email: customer.email,
    phone: customer.phone,
    externalRef,
    customerKind: 'CONSUMER',
  })
}

function channelTypeToOrderChannel(type: SalesChannelType): string {
  return type
}

export async function importChannelOrder(
  tenantId: string,
  connectionId: string,
  externalOrder: ExternalOrderDto,
): Promise<Order> {
  const connection = await salesChannelsDb.salesChannelConnection.findFirst({
    where: { id: connectionId, tenantId, isActive: true },
  })
  if (!connection) throw new ApiError(404, 'Sales channel connection not found')

  const existing = await salesChannelsDb.salesChannelOrder.findFirst({
    where: { connectionId, externalOrderId: externalOrder.externalOrderId },
    include: { connection: true },
  })
  if (existing) {
    const order = await orders.findOrderById(tenantId, existing.orderId)
    return order
  }

  const warehouses = await inv.listWarehouses(tenantId)
  const warehouse = warehouses.find((w) => w.isDefault) ?? warehouses[0]
  if (!warehouse) throw new ApiError(400, 'No warehouse configured')

  const lineItems: orders.CreateOrderInput['lineItems'] = []
  for (const line of externalOrder.lineItems) {
    const listing = await salesChannelsDb.salesChannelListing.findFirst({
      where: {
        connectionId,
        tenantId,
        externalListingId: line.externalListingId,
      },
    })
    if (!listing) {
      throw new ApiError(400, `No synced listing for external product ${line.externalListingId}`)
    }
    lineItems.push({
      skuId: listing.skuId,
      warehouseId: warehouse.id,
      quantity: Math.max(1, Math.floor(line.quantity)),
      unitPrice: line.unitPrice,
    })
  }

  if (lineItems.length === 0) throw new ApiError(400, 'Order has no mappable line items')

  const customer = await resolveOrCreateChannelCustomer(tenantId, connectionId, externalOrder.customer)

  const order = await orders.createOrder(
    tenantId,
    {
      customerId: customer.id,
      channel: channelTypeToOrderChannel(connection.type),
      paymentMethod: 'CARD',
      notes: externalOrder.notes,
      shippingAddress: externalOrder.shippingAddress,
      lineItems,
    },
    { skipPriceValidation: true },
  )

  await salesChannelsDb.salesChannelOrder.create({
    data: {
      tenantId,
      connectionId,
      orderId: order.id,
      externalOrderId: externalOrder.externalOrderId,
    },
  })

  return order
}

export async function getChannelOrderMapping(tenantId: string, orderId: string) {
  return salesChannelsDb.salesChannelOrder.findFirst({
    where: { tenantId, orderId },
    include: { connection: true },
  })
}
