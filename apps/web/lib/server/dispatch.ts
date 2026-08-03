import { Prisma, RouteStatus, StopStatus } from '@/generated/prisma-dispatch'
import { dispatchDb } from './db'
import { orderIdFromStopAddress } from './dispatch-order'
import * as crm from './crm'
import * as orderOrchestration from './order-orchestration'
import { orderDb } from './db'
import { ApiError } from './session'

export function listRoutes(tenantId: string, date?: string) {
  const where: Prisma.DeliveryRouteWhereInput = { tenantId }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const start = new Date(`${date}T00:00:00.000Z`)
    const end = new Date(`${date}T23:59:59.999Z`)
    where.OR = [
      { scheduledFor: { gte: start, lte: end } },
      { AND: [{ scheduledFor: null }, { createdAt: { gte: start, lte: end } }] },
    ]
  }
  return dispatchDb.deliveryRoute.findMany({
    where,
    include: { stops: { orderBy: { sequence: 'asc' } } },
    orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
  })
}

export async function getRoute(tenantId: string, id: string) {
  const row = await dispatchDb.deliveryRoute.findFirst({
    where: { id, tenantId },
    include: { stops: { orderBy: { sequence: 'asc' } } },
  })
  if (!row) throw new ApiError(404, 'Route not found')
  return row
}

export async function createRoute(
  tenantId: string,
  dto: {
    name?: string
    scheduledFor?: string
    stops: Array<{ sequence: number; address: Record<string, unknown> }>
  },
) {
  const seqs = new Set(dto.stops.map((s) => s.sequence))
  if (seqs.size !== dto.stops.length) throw new ApiError(400, 'Duplicate stop sequence')
  let scheduledFor: Date | undefined
  if (dto.scheduledFor?.trim()) {
    const d = new Date(dto.scheduledFor)
    if (Number.isNaN(d.getTime())) throw new ApiError(400, 'Invalid scheduledFor')
    scheduledFor = d
  }
  return dispatchDb.deliveryRoute.create({
    data: {
      tenantId,
      name: dto.name,
      scheduledFor,
      status: RouteStatus.PLANNED,
      stops: {
        create: dto.stops.map((s) => ({
          sequence: s.sequence,
          address: s.address as Prisma.InputJsonValue,
        })),
      },
    },
    include: { stops: { orderBy: { sequence: 'asc' } } },
  })
}

function addressFromOrder(
  order: {
    id: string
    customerId: string
    shippingAddress: unknown
    notes: string | null
  },
  customerName?: string,
): Record<string, unknown> {
  if (order.shippingAddress && typeof order.shippingAddress === 'object' && !Array.isArray(order.shippingAddress)) {
    return {
      ...(order.shippingAddress as Record<string, unknown>),
      orderId: order.id,
      customer: customerName,
    }
  }
  return {
    orderId: order.id,
    customer: customerName ?? order.customerId,
    line1: order.notes?.slice(0, 120) || 'Delivery address on file',
  }
}

export async function createRouteFromOrders(
  tenantId: string,
  dto: { orderIds: string[]; name?: string; scheduledFor?: string },
) {
  const ids = [...new Set(dto.orderIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) throw new ApiError(400, 'orderIds required')

  const orders = await orderDb.order.findMany({
    where: { tenantId, id: { in: ids }, status: 'SHIPPED' },
  })
  if (orders.length !== ids.length) {
    throw new ApiError(400, 'All orders must exist and be in SHIPPED status')
  }

  const customerNames = new Map<string, string>()
  for (const o of orders) {
    if (!customerNames.has(o.customerId)) {
      try {
        const c = await crm.getCustomer(tenantId, o.customerId)
        customerNames.set(o.customerId, c.name)
      } catch {
        customerNames.set(o.customerId, o.customerId)
      }
    }
  }

  const stops = orders.map((o, i) => ({
    sequence: i + 1,
    address: addressFromOrder(o, customerNames.get(o.customerId)),
  }))

  return createRoute(tenantId, {
    name: dto.name ?? `Delivery · ${orders.length} stop(s)`,
    scheduledFor: dto.scheduledFor,
    stops,
  })
}

export async function assignRouteDriver(tenantId: string, id: string, driverId: string) {
  const route = await getRoute(tenantId, id)
  if (route.status === RouteStatus.CANCELLED || route.status === RouteStatus.COMPLETED) {
    throw new ApiError(400, 'Route is not assignable')
  }
  return dispatchDb.deliveryRoute.update({
    where: { id },
    data: {
      driverId,
      status: RouteStatus.IN_PROGRESS,
    },
    include: { stops: { orderBy: { sequence: 'asc' } } },
  })
}

export async function recordDriverLocation(
  tenantId: string,
  userId: string,
  body: { lat: number; lng: number; timestamp?: string; routeId?: string },
) {
  const ts = body.timestamp ? new Date(body.timestamp) : new Date()
  const rid = body.routeId?.trim()
  if (rid) {
    const route = await dispatchDb.deliveryRoute.findFirst({ where: { id: rid, tenantId } })
    if (!route) throw new ApiError(404, 'Route not found')
    if (!route.driverId || route.driverId !== userId) {
      throw new ApiError(403, 'Location allowed only for the assigned driver')
    }
    await dispatchDb.deliveryRoute.update({
      where: { id: rid },
      data: {
        lastKnownLat: body.lat,
        lastKnownLng: body.lng,
        lastKnownAt: ts,
      },
    })
  }
  return { ok: true }
}

export async function reorderRouteStops(tenantId: string, routeId: string, stopIds: string[]) {
  await getRoute(tenantId, routeId)
  const stops = await dispatchDb.routeStop.findMany({ where: { routeId } })
  if (stopIds.length !== stops.length) {
    throw new ApiError(400, 'Must include every stop id for this route')
  }
  const expected = new Set(stops.map((s) => s.id))
  for (const id of stopIds) {
    if (!expected.has(id)) throw new ApiError(400, 'Unknown stop id for this route')
  }
  // Pass 1: Assign negative temporary sequences to prevent unique constraint collisions on (routeId, sequence)
  await dispatchDb.$transaction(
    stopIds.map((id, i) =>
      dispatchDb.routeStop.update({
        where: { id },
        data: { sequence: -(i + 1) },
      }),
    ),
  )

  // Pass 2: Assign final positive sequences
  await dispatchDb.$transaction(
    stopIds.map((id, i) =>
      dispatchDb.routeStop.update({
        where: { id },
        data: { sequence: i + 1 },
      }),
    ),
  )
  return getRoute(tenantId, routeId)
}

/** Haversine formula for spatial distance in kilometers. */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371 // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function extractStopCoords(addr: unknown): { lat: number; lng: number } {
  if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
    const o = addr as Record<string, unknown>
    const lat = typeof o.lat === 'number' ? o.lat : typeof o.latitude === 'number' ? o.latitude : NaN
    const lng = typeof o.lng === 'number' ? o.lng : typeof o.longitude === 'number' ? o.longitude : NaN
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng }
    }
  }

  // Fallback: Hash address string into pseudo-coordinates for sorting when coordinates aren't explicit
  const str = JSON.stringify(addr || '')
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  const pseudoLat = 32.7767 + ((hash % 1000) / 10000)
  const pseudoLng = -96.797 + (((hash >> 3) % 1000) / 10000)
  return { lat: pseudoLat, lng: pseudoLng }
}

/** Optimize route stops using Nearest-Neighbor spatial sorting. */
export async function optimizeRouteStopsNearestNeighbor(tenantId: string, routeId: string) {
  const route = await getRoute(tenantId, routeId)
  if (route.stops.length <= 1) return route

  const unvisited = [...route.stops]

  // Starting location: Driver's last known position if available, else first stop
  let currentPos: { lat: number; lng: number }
  if (
    typeof route.lastKnownLat === 'number' &&
    typeof route.lastKnownLng === 'number' &&
    Number.isFinite(route.lastKnownLat) &&
    Number.isFinite(route.lastKnownLng)
  ) {
    currentPos = { lat: route.lastKnownLat, lng: route.lastKnownLng }
  } else {
    const first = unvisited.shift()!
    currentPos = extractStopCoords(first.address)
    unvisited.unshift(first) // start from depot/first stop
  }

  const optimizedStops: typeof route.stops = []

  while (unvisited.length > 0) {
    let nearestIndex = 0
    let minDistance = Infinity

    for (let i = 0; i < unvisited.length; i++) {
      const stop = unvisited[i]!
      const coords = extractStopCoords(stop.address)
      const dist = haversineDistance(currentPos.lat, currentPos.lng, coords.lat, coords.lng)
      if (dist < minDistance) {
        minDistance = dist
        nearestIndex = i
      }
    }

    const nextStop = unvisited.splice(nearestIndex, 1)[0]!
    optimizedStops.push(nextStop)
    currentPos = extractStopCoords(nextStop.address)
  }

  const stopIds = optimizedStops.map((s) => s.id)
  return reorderRouteStops(tenantId, routeId, stopIds)
}

export async function markStopDelivered(
  tenantId: string,
  routeId: string,
  stopId: string,
  pod?: Record<string, unknown>,
  opts?: { userId?: string },
) {
  await getRoute(tenantId, routeId)
  const stop = await dispatchDb.routeStop.findFirst({ where: { id: stopId, routeId } })
  if (!stop) throw new ApiError(404, 'Stop not found')

  const orderId = orderIdFromStopAddress(stop.address)
  if (orderId) {
    const { assertDeliveryAgeCompliance } = await import('./compliance-age')
    await assertDeliveryAgeCompliance(tenantId, orderId, pod, opts?.userId)
  }

  await dispatchDb.routeStop.update({
    where: { id: stopId },
    data: {
      status: StopStatus.DELIVERED,
      ...(pod ? { pod: pod as never } : {}),
    },
  })

  if (orderId) {
    await orderOrchestration.onDeliveryStopDelivered(tenantId, orderId).catch(() => undefined)
  }

  const stops = await dispatchDb.routeStop.findMany({ where: { routeId } })
  const allDelivered = stops.every((s) => s.status === StopStatus.DELIVERED)
  if (allDelivered) {
    await dispatchDb.deliveryRoute.update({
      where: { id: routeId },
      data: { status: RouteStatus.COMPLETED },
    })
  }
  return getRoute(tenantId, routeId)
}

export async function markStopFailed(tenantId: string, routeId: string, stopId: string, _reason?: string) {
  await getRoute(tenantId, routeId)
  const stop = await dispatchDb.routeStop.findFirst({ where: { id: stopId, routeId } })
  if (!stop) throw new ApiError(404, 'Stop not found')

  await dispatchDb.routeStop.update({
    where: { id: stopId },
    data: { status: StopStatus.FAILED },
  })
  return getRoute(tenantId, routeId)
}
