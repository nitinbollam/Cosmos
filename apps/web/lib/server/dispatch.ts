import { Prisma, RouteStatus, StopStatus } from '@/generated/prisma-dispatch'
import { dispatchDb } from './db'
import { orderIdFromStopAddress } from './dispatch-order'
import { podEvidenceProblem } from './pod-evidence'
import { statusAfterAssign, statusAfterOutcome, unassignDriverProblem } from './route-assignment'
import { buildStopItems, NO_ITEMS } from './route-stop-items'
import { failureReasonProblem, normalizeFailureReason, podForDelivery, podWithFailure } from './stop-outcome'
import * as crm from './crm'
import * as orderOrchestration from './order-orchestration'
import { inventoryDb, orderDb } from './db'
import { getAgeVerificationPolicy } from './compliance-age'
import { ApiError } from './session'

export function listRoutes(tenantId: string, date?: string, statuses?: RouteStatus[]) {
  const where: Prisma.DeliveryRouteWhereInput = { tenantId, ...(statuses?.length ? { status: { in: statuses } } : {}) }
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

/**
 * A route with what is being delivered at each stop (product code, name, quantity and
 * the age check), for the driver app and the dispatch screens. Stops not linked to an
 * order get an empty list. Two lookups for the whole route, whatever its size.
 */
export async function getRouteDetail(tenantId: string, id: string) {
  const route = await getRoute(tenantId, id)
  const orderIds = [...new Set(route.stops.map((s) => orderIdFromStopAddress(s.address)).filter((x): x is string => !!x))]
  if (orderIds.length === 0) return { ...route, stops: route.stops.map((s) => ({ ...s, ...NO_ITEMS })) }

  const orders = await orderDb.order.findMany({
    where: { tenantId, id: { in: orderIds } },
    select: { id: true, lineItems: { select: { skuId: true, quantity: true } } },
  })
  const skuIds = [...new Set(orders.flatMap((o) => o.lineItems.map((l) => l.skuId)))]
  const [skus, policy] = await Promise.all([
    inventoryDb.sKU.findMany({
      where: { tenantId, id: { in: skuIds } },
      select: { id: true, code: true, name: true, isTobacco: true, ageRestricted: true, minimumAge: true },
    }),
    getAgeVerificationPolicy(tenantId),
  ])
  const skuMap = new Map(skus.map((s) => [s.id, s]))
  const linesByOrder = new Map(orders.map((o) => [o.id, o.lineItems]))

  return {
    ...route,
    stops: route.stops.map((s) => {
      const orderId = orderIdFromStopAddress(s.address)
      const lines = orderId ? linesByOrder.get(orderId) : undefined
      return { ...s, ...(lines ? buildStopItems(lines, skuMap, policy) : NO_ITEMS) }
    }),
  }
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
  await dispatchDb.deliveryRoute.update({
    where: { id },
    // ASSIGNED until the driver delivers or fails a stop; a route already under way stays IN_PROGRESS.
    data: { driverId, status: statusAfterAssign(route.status) as RouteStatus },
  })
  return getRouteDetail(tenantId, id)
}

/**
 * Take the driver off a route and send it back to PLANNED, undoing the assignment.
 * Refused once any stop has an outcome (see `unassignDriverProblem`).
 */
export async function unassignRouteDriver(tenantId: string, id: string) {
  const route = await getRoute(tenantId, id)
  const problem = unassignDriverProblem(route)
  if (problem) throw new ApiError(problem.status, problem.message)
  if (!route.driverId && route.status === RouteStatus.PLANNED) return getRouteDetail(tenantId, id)
  await dispatchDb.deliveryRoute.update({
    where: { id },
    data: {
      driverId: null,
      status: RouteStatus.PLANNED,
      // The last known position belonged to the driver who is no longer on the route.
      lastKnownLat: null,
      lastKnownLng: null,
      lastKnownAt: null,
    },
  })
  return getRouteDetail(tenantId, id)
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
  // Proof of delivery is evidence: a repeat submit (double tap, stale screen) must
  // not replace it, least of all with an empty photo and signature.
  if (stop.status === StopStatus.DELIVERED) {
    throw new ApiError(409, 'Stop is already delivered; proof of delivery cannot be replaced')
  }
  const podProblem = podEvidenceProblem(pod)
  if (podProblem) throw new ApiError(400, podProblem)

  const orderId = orderIdFromStopAddress(stop.address)
  if (orderId) {
    const { assertDeliveryAgeCompliance } = await import('./compliance-age')
    await assertDeliveryAgeCompliance(tenantId, orderId, pod, opts?.userId)
  }

  await dispatchDb.routeStop.update({
    where: { id: stopId },
    data: {
      status: StopStatus.DELIVERED,
      // A failure recorded on an earlier attempt stays on the stop.
      pod: podForDelivery(stop.pod, pod) as never,
    },
  })

  if (orderId) {
    await orderOrchestration.onDeliveryStopDelivered(tenantId, orderId).catch(() => undefined)
  }

  await updateRouteAfterOutcome(routeId)
  return getRouteDetail(tenantId, routeId)
}

export async function markStopFailed(
  tenantId: string,
  routeId: string,
  stopId: string,
  reason?: unknown,
  opts?: { userId?: string },
) {
  await getRoute(tenantId, routeId)
  const stop = await dispatchDb.routeStop.findFirst({ where: { id: stopId, routeId } })
  if (!stop) throw new ApiError(404, 'Stop not found')
  // A delivered stop has its proof of delivery on record; flipping it to failed
  // would hide that evidence and contradict the order's delivered status.
  if (stop.status === StopStatus.DELIVERED) {
    throw new ApiError(409, 'Stop is already delivered and cannot be marked failed')
  }
  // Keep the first recorded reason rather than overwrite it.
  if (stop.status === StopStatus.FAILED) {
    throw new ApiError(409, 'Stop is already marked failed')
  }
  const reasonProblem = failureReasonProblem(reason)
  if (reasonProblem) throw new ApiError(400, reasonProblem)

  await dispatchDb.routeStop.update({
    where: { id: stopId },
    data: {
      status: StopStatus.FAILED,
      pod: podWithFailure(stop.pod, {
        reason: normalizeFailureReason(reason)!,
        failedAt: new Date().toISOString(),
        ...(opts?.userId ? { failedBy: opts.userId } : {}),
      }) as never,
    },
  })

  await updateRouteAfterOutcome(routeId)
  return getRouteDetail(tenantId, routeId)
}

/** After a stop gets an outcome: an ASSIGNED route starts (IN_PROGRESS); once every stop has one, COMPLETED. */
async function updateRouteAfterOutcome(routeId: string) {
  const route = await dispatchDb.deliveryRoute.findUnique({ where: { id: routeId }, include: { stops: true } })
  if (!route) return
  const next = statusAfterOutcome(route.status, route.stops.map((s) => s.status))
  if (next !== route.status) {
    await dispatchDb.deliveryRoute.update({ where: { id: routeId }, data: { status: next as RouteStatus } })
  }
}
