import { Prisma, ShipmentStatus } from '@/generated/prisma-order'
import { orderDb } from './db'
import { ApiError } from './session'

export async function listOrderShipments(tenantId: string, orderId: string) {
  const rows = await orderDb.orderShipment.findMany({
    where: { tenantId, orderId },
    orderBy: { shipmentNo: 'asc' },
  })
  const skuIds = [
    ...new Set(
      rows.flatMap((r) =>
        Array.isArray(r.lineItems)
          ? (r.lineItems as Array<{ skuId?: string }>).map((l) => l.skuId).filter(Boolean)
          : [],
      ),
    ),
  ] as string[]
  const { inventoryDb } = await import('./db')
  const skus =
    skuIds.length > 0
      ? await inventoryDb.sKU.findMany({ where: { tenantId, id: { in: skuIds } } })
      : []
  const skuMap = new Map(skus.map((s) => [s.id, s]))

  return rows.map((r) => {
    const rawItems = Array.isArray(r.lineItems)
      ? (r.lineItems as Array<{ skuId: string; warehouseId: string; quantity: number }>)
      : []
    return {
      ...r,
      lineItems: rawItems.map((li) => {
        const sku = skuMap.get(li.skuId)
        return {
          ...li,
          skuCode: sku?.code ?? null,
          skuName: sku?.name ?? null,
        }
      }),
    }
  })
}

export async function createOrderShipments(
  tenantId: string,
  orderId: string,
  shipments: Array<{
    carrier?: string
    trackingNumber?: string
    lineItems: Array<{ skuId: string; warehouseId: string; quantity: number }>
  }>,
) {
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (shipments.length === 0) throw new ApiError(400, 'At least one shipment required')

  const { checkBatchNotRecalled } = await import('./compliance-recall')
  for (const li of order.lineItems) {
    if (li.preferredBatchId) {
      await checkBatchNotRecalled(tenantId, li.preferredBatchId, li.skuId)
    }
  }

  const allocated = new Map<string, number>()
  for (const ship of shipments) {
    for (const li of ship.lineItems) {
      const key = `${li.skuId}:${li.warehouseId}`
      allocated.set(key, (allocated.get(key) ?? 0) + li.quantity)
    }
  }
  for (const li of order.lineItems) {
    const key = `${li.skuId}:${li.warehouseId}`
    const want = allocated.get(key) ?? 0
    if (want !== li.quantity) {
      throw new ApiError(400, `Shipment quantities must match order for SKU ${li.skuId}`)
    }
  }

  await orderDb.orderShipment.deleteMany({ where: { tenantId, orderId } })
  const created = []
  for (let i = 0; i < shipments.length; i++) {
    const s = shipments[i]!
    const row = await orderDb.orderShipment.create({
      data: {
        tenantId,
        orderId,
        shipmentNo: i + 1,
        status: ShipmentStatus.PENDING,
        carrier: s.carrier,
        trackingNumber: s.trackingNumber,
        lineItems: s.lineItems as never,
      },
    })
    created.push(row)
  }
  if (shipments.some((s) => s.carrier?.trim() && s.trackingNumber?.trim())) {
    void import('./sales-channels/fulfillment-sync')
      .then(({ syncChannelFulfillmentForOrder }) => syncChannelFulfillmentForOrder(tenantId, orderId))
      .catch((err) => console.error(`[sales-channels] fulfillment sync failed for order ${orderId}:`, err))
  }
  return created
}

export async function markShipmentShipped(tenantId: string, shipmentId: string) {
  const row = await orderDb.orderShipment.findFirst({ where: { id: shipmentId, tenantId } })
  if (!row) throw new ApiError(404, 'Shipment not found')

  const order = await orderDb.order.findFirst({
    where: { id: row.orderId, tenantId },
    include: { lineItems: true },
  })
  if (order) {
    const { checkBatchNotRecalled } = await import('./compliance-recall')
    for (const li of order.lineItems) {
      if (li.preferredBatchId) {
        await checkBatchNotRecalled(tenantId, li.preferredBatchId, li.skuId)
      }
    }
  }

  const updated = await orderDb.orderShipment.update({
    where: { id: shipmentId },
    data: { status: ShipmentStatus.SHIPPED, shippedAt: new Date() },
  })
  if (updated.carrier?.trim() && updated.trackingNumber?.trim()) {
    void import('./sales-channels/fulfillment-sync')
      .then(({ syncChannelFulfillmentForOrder }) => syncChannelFulfillmentForOrder(tenantId, updated.orderId))
      .catch((err) => console.error(`[sales-channels] fulfillment sync failed for order ${updated.orderId}:`, err))
  }
  return updated
}

export async function getOrderTracking(tenantId: string, orderId: string, opts?: { buyerCustomerId?: string }) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')
  if (opts?.buyerCustomerId && order.customerId !== opts.buyerCustomerId) {
    throw new ApiError(404, 'Order not found')
  }

  const shipments = await listOrderShipments(tenantId, orderId)
  const { dispatchDb } = await import('./db')
  const { orderIdFromStopAddress } = await import('./dispatch-order')

  const routes = await dispatchDb.deliveryRoute.findMany({
    where: { tenantId, status: { in: ['PLANNED', 'IN_PROGRESS'] } },
    include: { stops: { orderBy: { sequence: 'asc' } } },
    orderBy: { scheduledFor: 'asc' },
    take: 20,
  })

  let delivery: {
    routeId: string
    routeStatus: string
    stopStatus: string
    stopSequence: number
    eta: Date | null
    podPhotoUrl: string | null
  } | null = null

  for (const route of routes) {
    const stop = route.stops.find((s) => orderIdFromStopAddress(s.address) === orderId)
    if (stop) {
      const eta = route.scheduledFor
        ? new Date(route.scheduledFor.getTime() + (stop.sequence - 1) * 45 * 60 * 1000)
        : null
      // Proof-of-delivery photo, exposed so the customer can see their own
      // delivery. `pod` is an opaque JSON column, so read it defensively rather
      // than trusting a shape. Only the photo is surfaced — notes and age
      // confirmation stay internal to staff.
      const podRecord =
        stop.pod && typeof stop.pod === 'object' && !Array.isArray(stop.pod)
          ? (stop.pod as Record<string, unknown>)
          : null
      const rawPhoto = podRecord?.photoUrl
      const podPhotoUrl = typeof rawPhoto === 'string' && rawPhoto ? rawPhoto : null

      delivery = {
        routeId: route.id,
        routeStatus: route.status,
        stopStatus: stop.status,
        stopSequence: stop.sequence,
        eta,
        podPhotoUrl,
      }
      break
    }
  }

  return { orderStatus: order.status, shipments, delivery }
}
