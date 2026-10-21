/**
 * Pure helpers for the driver app's Today view (PLR-165): which day a route belongs to, how far
 * along it is, what is next, and the end-of-route summary. No React, no network, so it is testable.
 */
export type StopLite = { id: string; sequence: number; status: string; address?: unknown; pod?: { deliveredAt?: string | null; failure?: { failedAt?: string } | null } | null }
export type RouteLite = {
  id: string
  name?: string | null
  status: string
  scheduledFor?: string | null
  createdAt?: string
  stops?: StopLite[]
}

export type RouteGroups = { today: RouteLite[]; later: RouteLite[]; earlier: RouteLite[] }

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The day a route is for: its scheduled date, or the day it was created when it has none. */
export function routeDay(r: RouteLite): Date | null {
  const raw = r.scheduledFor ?? r.createdAt
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Today's routes, plus anything already under way (a route that runs past midnight stays "today"). */
export function groupRoutes(routes: RouteLite[], now: Date = new Date()): RouteGroups {
  const today = dayKey(now)
  const g: RouteGroups = { today: [], later: [], earlier: [] }
  for (const r of routes) {
    const d = routeDay(r)
    const key = d ? dayKey(d) : today
    if (r.status === 'IN_PROGRESS' || key === today) g.today.push(r)
    else if (key > today) g.later.push(r)
    else g.earlier.push(r)
  }
  const byTime = (a: RouteLite, b: RouteLite) => (routeDay(a)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (routeDay(b)?.getTime() ?? Number.MAX_SAFE_INTEGER)
  g.today.sort(byTime)
  g.later.sort(byTime)
  g.earlier.sort((a, b) => byTime(b, a))
  return g
}

const DONE = new Set(['DELIVERED', 'FAILED'])

export function routeProgress(r: RouteLite): { total: number; delivered: number; failed: number; remaining: number; percent: number } {
  const stops = r.stops ?? []
  const delivered = stops.filter((s) => s.status === 'DELIVERED').length
  const failed = stops.filter((s) => s.status === 'FAILED').length
  const total = stops.length
  return { total, delivered, failed, remaining: total - delivered - failed, percent: total === 0 ? 0 : Math.round(((delivered + failed) / total) * 100) }
}

/** The first stop, in sequence, that still needs an outcome. */
export function nextStop(r: RouteLite): StopLite | null {
  return [...(r.stops ?? [])].sort((a, b) => a.sequence - b.sequence).find((s) => !DONE.has(s.status)) ?? null
}

/** Name and one-line address of a stop, from its address JSON. */
export function stopLabel(address: unknown): { who: string | null; where: string } {
  if (typeof address === 'string') return { who: null, where: address }
  if (!address || typeof address !== 'object') return { who: null, where: '' }
  const a = address as Record<string, unknown>
  const str = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : null)
  const cityLine = [str('city'), [str('state'), str('postalCode')].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return { who: str('company') ?? str('customer'), where: [str('line1'), str('line2'), cityLine].filter(Boolean).join(', ') }
}

/** A maps link that opens the native app on phones. Coordinates win when the stop has them. */
export function navigationUrl(address: unknown): string | null {
  const a = address && typeof address === 'object' ? (address as Record<string, unknown>) : null
  const lat = Number(a?.lat ?? a?.latitude)
  const lng = Number(a?.lng ?? a?.longitude)
  if (a && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  }
  const { where } = stopLabel(address)
  return where ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(where)}` : null
}

/** A `tel:` link from a phone number, or null when there are no digits to dial. */
export function telUrl(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/[^\d+]/g, '')
  return digits.replace(/\D/g, '').length >= 7 ? `tel:${digits}` : null
}

/** End-of-route numbers: outcomes and the span between the first and last recorded time. */
export function routeSummary(r: RouteLite): { delivered: number; failed: number; minutes: number | null } {
  const p = routeProgress(r)
  const times = (r.stops ?? [])
    .map((s) => s.pod?.deliveredAt ?? s.pod?.failure?.failedAt ?? null)
    .filter((t): t is string => !!t)
    .map((t) => new Date(t).getTime())
    .filter((t) => Number.isFinite(t))
  const minutes = times.length >= 2 ? Math.round((Math.max(...times) - Math.min(...times)) / 60_000) : null
  return { delivered: p.delivered, failed: p.failed, minutes }
}
