import { Prisma, ShipmentStatus } from '@/generated/prisma-order'
import { orderDb } from './db'
import { ApiError } from './session'

export async function listOrderShipments(tenantId: string, orderId: string) {
  return orderDb.orderShipment.findMany({
    where: { tenantId, orderId },
    orderBy: { shipmentNo: 'asc' },
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
  return created
}

export async function markShipmentShipped(tenantId: string, shipmentId: string) {
  const row = await orderDb.orderShipment.findFirst({ where: { id: shipmentId, tenantId } })
  if (!row) throw new ApiError(404, 'Shipment not found')
  return orderDb.orderShipment.update({
    where: { id: shipmentId },
    data: { status: ShipmentStatus.SHIPPED, shippedAt: new Date() },
  })
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
  } | null = null

  for (const route of routes) {
    const stop = route.stops.find((s) => orderIdFromStopAddress(s.address) === orderId)
    if (stop) {
      const eta = route.scheduledFor
        ? new Date(route.scheduledFor.getTime() + (stop.sequence - 1) * 45 * 60 * 1000)
        : null
      delivery = {
        routeId: route.id,
        routeStatus: route.status,
        stopStatus: stop.status,
        stopSequence: stop.sequence,
        eta,
      }
      break
    }
  }

  return { orderStatus: order.status, shipments, delivery }
}
