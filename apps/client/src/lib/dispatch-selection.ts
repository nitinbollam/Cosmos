/**
 * Which route and manifest day the admin Dispatch board shows. The URL (`?route=&date=`) is the
 * only source of truth, so a link can open any route on any day; `dispatchSelectionChange` says
 * what to write back when the URL and the data disagree. Each change it returns makes its own
 * condition false, so the board settles in a step or two instead of looping. No React, no
 * network, so it is testable.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** A `yyyy-mm-dd` that is a real calendar day, else null (the API ignores a bad date and lists every route). */
export function parseYmd(raw: string | null | undefined): string | null {
  if (!raw || !YMD.test(raw)) return null
  const d = new Date(`${raw}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw ? raw : null
}

/**
 * The manifest day a route is listed under, matching the server's `GET /routes?date=` filter:
 * the UTC day of `scheduledFor`, or of `createdAt` when it has none.
 */
export function routeManifestDate(r: { scheduledFor?: string | null; createdAt?: string | null }): string | null {
  const raw = r.scheduledFor ?? r.createdAt
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Query params to write: `route: null` removes the route, `date: null` goes back to today. */
export type DispatchUrlChange = { route?: string | null; date?: string | null }

type RouteDay = { id: string; scheduledFor?: string | null; createdAt?: string | null }

export function dispatchSelectionChange(s: {
  routeId: string | null
  date: string
  /** Routes listed for `date`; undefined while loading. */
  list: { id: string }[] | undefined
  /** The selected route: undefined while loading (or on a non-404 error), null when it does not exist. */
  detail: RouteDay | null | undefined
}): DispatchUrlChange | null {
  if (!s.routeId) {
    // Nothing chosen: open the day's first route.
    return s.list?.length ? { route: s.list[0].id } : null
  }
  if (s.detail === null) {
    // A link to a route that doesn't exist: drop it, for the day's first route when there is one.
    return { route: s.list?.find((r) => r.id !== s.routeId)?.id ?? null }
  }
  if (s.detail && s.detail.id === s.routeId) {
    // A link to a route on another day: show that day, so the route is in the list.
    const day = routeManifestDate(s.detail)
    if (day && day !== s.date) return { date: day }
  }
  return null
}
