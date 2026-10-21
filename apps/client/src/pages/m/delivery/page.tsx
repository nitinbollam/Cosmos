import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api-mobile'
import { OfflineBanner } from '@/components/mobile/offline-banner'
import { enqueueAction } from '@/lib/offline-queue'
import { axiosErr } from '@/lib/axios-error'
import { groupRoutes, nextStop, routeProgress, routeSummary, stopLabel, type RouteLite } from '@/lib/driver-routes'
import { useDriverLocation } from '@/lib/use-driver-location'

type Route = RouteLite

function statusText(r: Route): string {
  if (r.status === 'ASSIGNED') return 'Not started'
  if (r.status === 'COMPLETED') return 'Completed'
  return r.status.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())
}

function RouteCard({ r }: { r: Route }) {
  const p = routeProgress(r)
  const next = nextStop(r)
  const label = next ? stopLabel(next.address) : null
  const done = r.status === 'COMPLETED'
  const summary = done ? routeSummary(r) : null
  return (
    <Link
      to={`/m/delivery/route/${r.id}`}
      className="pleros-mobile-card"
      style={{ display: 'block', color: 'inherit', textDecoration: 'none', marginBottom: 10 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>{r.name?.trim() || `Route ${r.id.slice(-8)}`}</strong>
        <span style={{ fontSize: 12, opacity: 0.8 }}>{statusText(r)}</span>
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.75 }}>
        {p.total} stop{p.total === 1 ? '' : 's'} · {p.delivered} delivered
        {p.failed > 0 ? ` · ${p.failed} failed` : ''}
        {p.remaining > 0 ? ` · ${p.remaining} to go` : ''}
      </p>
      <div
        role="progressbar"
        aria-valuenow={p.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Route progress"
        style={{ height: 6, borderRadius: 3, background: 'rgba(127,127,127,0.25)', marginTop: 8, overflow: 'hidden' }}
      >
        <div style={{ width: `${p.percent}%`, height: '100%', background: 'var(--c-accent)' }} />
      </div>
      {next && label && (
        <p style={{ margin: '8px 0 0', fontSize: 13 }}>
          <span style={{ opacity: 0.6 }}>Next · stop #{next.sequence} </span>
          <strong>{label.who ?? 'Customer'}</strong>
          {label.where && <span style={{ display: 'block', opacity: 0.7 }}>{label.where}</span>}
        </p>
      )}
      {summary && (
        <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.8 }}>
          Finished · {summary.delivered} delivered, {summary.failed} failed
          {summary.minutes != null ? ` · ${Math.floor(summary.minutes / 60)}h ${summary.minutes % 60}m on the road` : ''}
        </p>
      )}
    </Link>
  )
}

function Section({ title, routes }: { title: string; routes: Route[] }) {
  if (routes.length === 0) return null
  return (
    <section style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, margin: '0 0 8px', opacity: 0.8 }}>{title}</h2>
      {routes.map((r) => (
        <RouteCard key={r.id} r={r} />
      ))}
    </section>
  )
}

const LOCATION_TEXT: Record<string, string> = {
  sharing: 'Sharing your location with dispatch while a route is active.',
  denied: 'Location is blocked. Allow it in your browser settings so dispatch can see where you are.',
  unsupported: 'This device cannot share its location.',
  error: 'Could not get your position. Check that location is on.',
}

export default function DeliveryMobilePage() {
  const [routes, setRoutes] = useState<Route[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setErr(null)
    try {
      // The server returns only this driver's routes. Completed routes are kept for today's summary.
      const data = await api.get<Route[]>('/routes?status=ASSIGNED,IN_PROGRESS,COMPLETED')
      setRoutes(Array.isArray(data) ? data : [])
    } catch (e) {
      if (!navigator.onLine) {
        enqueueAction('dispatch_routes_refresh', {})
        setErr('Offline — route list may be stale')
      } else {
        setErr(axiosErr(e))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => {
    const g = groupRoutes(routes)
    // Finished routes only matter on the day they were driven.
    return { ...g, earlier: g.earlier.filter((r) => r.status !== 'COMPLETED'), later: g.later.filter((r) => r.status !== 'COMPLETED') }
  }, [routes])

  const activeIds = useMemo(
    () => groups.today.filter((r) => r.status === 'ASSIGNED' || r.status === 'IN_PROGRESS').map((r) => r.id),
    [groups],
  )
  const location = useDriverLocation(activeIds)

  const todayDone = groups.today.filter((r) => r.status === 'COMPLETED')
  const todayOpen = groups.today.filter((r) => r.status !== 'COMPLETED')
  const empty = !loading && !err && routes.length === 0

  return (
    <div>
      <OfflineBanner />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', margin: 0 }}>Today</h1>
        <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      {location !== 'idle' && (
        <p
          role="status"
          style={{ fontSize: 12, margin: '0 0 12px', opacity: 0.8, color: location === 'sharing' ? undefined : 'var(--c-danger)' }}
        >
          {LOCATION_TEXT[location]}
        </p>
      )}
      {err && <p style={{ color: 'var(--c-danger)', fontSize: 13 }}>{err}</p>}
      {loading && <p style={{ opacity: 0.6 }}>Loading…</p>}
      <Section title="Today" routes={todayOpen} />
      <Section title="Finished today" routes={todayDone} />
      <Section title="Coming up" routes={groups.later} />
      <Section title="Overdue" routes={groups.earlier} />
      {empty && <p style={{ opacity: 0.6, textAlign: 'center', marginTop: 24 }}>No routes assigned to you</p>}
    </div>
  )
}
