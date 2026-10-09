import { orderIdFromStopAddress } from './dispatch-order'

/** The slice of a delivery route that order tracking needs. */
export type TrackingRoute = {
  id: string
  status: string
  scheduledFor: Date | null
  createdAt: Date
  stops: Array<{ sequence: number; status: string; address: unknown; pod: unknown }>
}

export type OrderDelivery = {
  routeId: string
  routeStatus: string
  stopStatus: string
  stopSequence: number
  eta: Date | null
  deliveredAt: string | null
  podPhotoUrl: string | null
}

const STOP_MINUTES = 45

/** `pod` is an opaque JSON column, so read it defensively rather than trusting a shape. */
function podRecord(pod: unknown): Record<string, unknown> | null {
  return pod && typeof pod === 'object' && !Array.isArray(pod) ? (pod as Record<string, unknown>) : null
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

/**
 * Find the delivery stop for an order across the given routes.
 *
 * Routes in every status count, COMPLETED included: a route completes the moment
 * its last stop is delivered, which is exactly when a customer goes looking for
 * proof of delivery. Only CANCELLED routes are ignored. When an order sits on
 * more than one route (a failed attempt, then a redelivery) the newest route wins.
 *
 * Only the photo leaves this function. Signature, notes and age confirmation stay
 * internal to staff.
 */
export function findOrderDelivery(routes: TrackingRoute[], orderId: string): OrderDelivery | null {
  const newestFirst = routes
    .filter((r) => r.status !== 'CANCELLED')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  for (const route of newestFirst) {
    const stop = route.stops.find((s) => orderIdFromStopAddress(s.address) === orderId)
    if (!stop) continue

    const pod = podRecord(stop.pod)
    const finished = stop.status === 'DELIVERED' || stop.status === 'FAILED'
    // An ETA only means something while the stop is still to come.
    const eta =
      !finished && route.scheduledFor
        ? new Date(route.scheduledFor.getTime() + (stop.sequence - 1) * STOP_MINUTES * 60 * 1000)
        : null

    return {
      routeId: route.id,
      routeStatus: route.status,
      stopStatus: stop.status,
      stopSequence: stop.sequence,
      eta,
      deliveredAt: stop.status === 'DELIVERED' ? nonEmptyString(pod?.deliveredAt) : null,
      podPhotoUrl: nonEmptyString(pod?.photoUrl),
    }
  }
  return null
}
