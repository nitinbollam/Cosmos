import { ApiError } from './session'

/**
 * What a driver may see and do in dispatch (PLR-165).
 *
 * The DRIVER role carries `dispatch.*`, which is also what managers need to plan routes. Without
 * these checks a driver could list every route in the company, open another driver's route, mark
 * their stops delivered, or reassign routes. Managers and admins are not drivers and keep the full
 * view. Kept free of DB imports so the rules can be unit-tested on their own.
 */

export function isDriverRole(role: string | null | undefined): boolean {
  return (role ?? '').toUpperCase() === 'DRIVER'
}

/** The driver id to filter routes by, or undefined when the caller may see every route. */
export function driverFilter(session: { role: string; userId: string }): string | undefined {
  return isDriverRole(session.role) ? session.userId : undefined
}

/** Throws 404 (not 403, so route ids are not confirmable) unless the caller may see this route. */
export function assertRouteVisible(
  session: { role: string; userId: string },
  route: { driverId?: string | null },
): void {
  if (isDriverRole(session.role) && route.driverId !== session.userId) {
    throw new ApiError(404, 'Route not found')
  }
}

/**
 * Route operations a driver may perform, as `METHOD path-shape` where path segments after
 * `routes` are matched by length and name. Everything else (planning, assigning, reordering,
 * creating, listing shipped orders) needs a non-driver role.
 */
export function driverMayCallRoutes(method: string, seg: string[]): boolean {
  if (method === 'GET' && seg.length === 1) return true
  if (method === 'GET' && seg.length === 2 && seg[1] !== 'shipped-orders') return true
  if (method === 'POST' && seg.length === 5 && seg[2] === 'stops' && (seg[4] === 'delivered' || seg[4] === 'failed')) {
    return true
  }
  if (method === 'POST' && seg.length === 5 && seg[2] === 'stops' && (seg[4] === 'adjust' || seg[4] === 'van-sale')) return true
  return false
}

export type DriverLocation = { routeId: string; lat: number; lng: number; timestamp: Date }

/** Validates a location ping. A (0, 0) fix is the "no GPS" default and is rejected. */
export function parseDriverLocation(body: unknown, now: Date = new Date()): DriverLocation {
  const b = (body ?? {}) as Record<string, unknown>
  const routeId = typeof b.routeId === 'string' ? b.routeId.trim() : ''
  if (!routeId) throw new ApiError(400, 'routeId is required')
  const lat = Number(b.lat)
  const lng = Number(b.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new ApiError(400, 'lat and lng must be valid coordinates')
  }
  if (lat === 0 && lng === 0) throw new ApiError(400, 'A position of exactly 0, 0 is not a real fix')
  let timestamp = now
  if (typeof b.timestamp === 'string' && b.timestamp.trim()) {
    const t = new Date(b.timestamp)
    if (Number.isNaN(t.getTime())) throw new ApiError(400, 'timestamp is not a valid date')
    // A device clock far in the future would pin the "last seen" time; a stale one is fine.
    timestamp = t.getTime() > now.getTime() + 5 * 60_000 ? now : t
  }
  return { routeId, lat, lng, timestamp }
}
