import { Link } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-mobile'
import { OfflineBanner } from '@/components/mobile/offline-banner'
import { enqueueAction } from '@/lib/offline-queue'
import { axiosErr } from '@/lib/axios-error'

type Route = {
  id: string
  status: string
  driverId?: string
  stops?: { id: string; sequence: number; status: string }[]
}

export default function DeliveryMobilePage() {
  const [routes, setRoutes] = useState<Route[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const data = await api.get<Route[]>('/routes?status=IN_PROGRESS')
      setRoutes(Array.isArray(data) ? data : [])
    } catch (e) {
      if (!navigator.onLine) {
        enqueueAction('dispatch_routes_refresh', {})
        setErr('Offline — route list may be stale')
      } else {
        setErr(axiosErr(e))
      }
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => {
      if (!navigator.onLine) return
      void api
        .post('/dispatch/driver/location', {
          latitude: 0,
          longitude: 0,
          recordedAt: new Date().toISOString(),
        })
        .catch(() => undefined)
    }, 30_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div>
      <OfflineBanner />
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Active routes</h1>
      <button type="button" className="btn-ghost" onClick={() => void load()} style={{ marginBottom: 12 }}>
        Refresh
      </button>
      {err && <p style={{ color: 'var(--c-danger)', fontSize: 13 }}>{err}</p>}
      {routes.map((r) => (
        <Link
          key={r.id}
          to={`/m/delivery/route/${r.id}`}
          className="pleros-mobile-card"
          style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
        >
          <strong>Route {r.id.slice(-8)}</strong>
          <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.7 }}>
            {r.status} · {(r.stops ?? []).length} stops
          </p>
        </Link>
      ))}
      {routes.length === 0 && !err && <p style={{ opacity: 0.6 }}>No active routes</p>}
    </div>
  )
}
