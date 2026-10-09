import { isRouteFinished } from './stop-outcome'

/**
 * Route status rules around assigning a driver:
 *
 *   PLANNED ──assign──▶ ASSIGNED ──first stop delivered/failed──▶ IN_PROGRESS ──all stops done──▶ COMPLETED
 *      ▲                    │
 *      └──────unassign──────┘   (also from IN_PROGRESS while no stop has an outcome)
 *
 * Unassigning only works while no stop has an outcome: once the driver has delivered
 * or failed a stop the route is genuinely under way, so it is reassigned to another
 * driver rather than sent back to planning.
 *
 * Kept free of DB and session imports so it can be unit-tested on its own.
 */
type RouteForUnassign = {
  status: string
  driverId?: string | null
  stops: Array<{ status: string }>
}

/** Why the driver can't be taken off this route, or null when they can. */
export function unassignDriverProblem(route: RouteForUnassign): { status: number; message: string } | null {
  if (route.status === 'COMPLETED' || route.status === 'CANCELLED') {
    return { status: 409, message: `A ${route.status.toLowerCase()} route can't be unassigned` }
  }
  if (route.stops.some((s) => s.status === 'DELIVERED' || s.status === 'FAILED')) {
    return {
      status: 409,
      message: 'This route has delivered or failed stops; assign another driver instead of unassigning',
    }
  }
  return null
}

/** Status after a driver is assigned: ASSIGNED until work starts; a route already under way stays IN_PROGRESS. */
export function statusAfterAssign(current: string): 'ASSIGNED' | 'IN_PROGRESS' {
  return current === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'ASSIGNED'
}

/**
 * Status after a stop gets an outcome (delivered or failed): COMPLETED once every stop
 * has one; an ASSIGNED route becomes IN_PROGRESS at its first outcome; otherwise unchanged
 * (a PLANNED route without a driver stays PLANNED if staff fail a stop on it).
 */
export function statusAfterOutcome(current: string, stopStatuses: string[]): string {
  if (isRouteFinished(stopStatuses)) return 'COMPLETED'
  if (current === 'ASSIGNED') return 'IN_PROGRESS'
  return current
}
