import { Link } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'

type Stop = { id: string; sequence: number; status: string; address?: string }

type RouteDetail = {
  id: string
  status: string
  stops: Stop[]
}

export default function DeliveryRoutePage() {
  const { id } = useParams<{ id: string }>()
  const [route, setRoute] = useState<RouteDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!id) return
    void api
      .get<RouteDetail>(`/routes/${encodeURIComponent(id)}`)
      .then(setRoute)
      .catch((e) => setErr(axiosErr(e)))
  }, [id])

  async function refreshRoute() {
    if (!id) return
    const refreshed = await api.get<RouteDetail>(`/routes/${encodeURIComponent(id)}`)
    setRoute(refreshed)
  }

  async function markDelivered(stopId: string) {
    if (!id) return
    try {
      await api.post(`/dispatch/stops/${stopId}/pod`, {
        routeId: id,
        deliveredAt: new Date().toISOString(),
        signatureDataUrl: null,
        photoUrl: null,
        notes: notes || undefined,
      })
      await refreshRoute()
    } catch (e) {
      setErr(axiosErr(e))
    }
  }

  async function markFailed(stopId: string) {
    if (!id) return
    const reason = window.prompt('Failure reason?')?.trim()
    if (!reason) return
    try {
      await api.post(`/routes/${encodeURIComponent(id)}/stops/${encodeURIComponent(stopId)}/failed`, {
        reason,
      })
      await refreshRoute()
    } catch (e) {
      setErr(axiosErr(e))
    }
  }

  return (
    <div>
      <Link to="/m/delivery" style={{ color: '#94a3b8', fontSize: 13 }}>
        ← Routes
      </Link>
      <h1 style={{ fontFamily: 'var(--font-syne)' }}>Route {id?.slice(-8)}</h1>
      {err && <p style={{ color: '#f87171' }}>{err}</p>}
      <textarea
        className="cosmos-input"
        placeholder="POD notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        style={{ width: '100%', marginBottom: 12 }}
      />
      {(route?.stops ?? []).map((s) => (
        <div key={s.id} className="cosmos-mobile-card">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>Stop #{s.sequence}</strong>
            <span style={{ fontSize: 12 }}>{s.status}</span>
          </div>
          {s.address && <p style={{ fontSize: 13, opacity: 0.7 }}>{s.address}</p>}
          {s.status !== 'DELIVERED' && s.status !== 'FAILED' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-primary" onClick={() => void markDelivered(s.id)}>
                Delivered
              </button>
              <button type="button" className="btn-ghost" onClick={() => void markFailed(s.id)}>
                Failed
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
