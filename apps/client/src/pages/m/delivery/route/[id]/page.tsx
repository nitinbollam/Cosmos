import { Link } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-mobile'
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
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [recipientName, setRecipientName] = useState('')

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
        ageConfirmed,
        recipientName: recipientName.trim() || undefined,
      })
      await refreshRoute()
      setErr(null)
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
      <Link to="/m/delivery" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
        ← Routes
      </Link>
      <h1 style={{ fontFamily: 'var(--font-display)' }}>Route {id?.slice(-8)}</h1>
      {err && <p style={{ color: 'var(--c-danger)' }}>{err}</p>}
      <input
        className="pleros-input"
        placeholder="Recipient name (optional)"
        value={recipientName}
        onChange={(e) => setRecipientName(e.target.value)}
        style={{ width: '100%', marginBottom: 8 }}
      />
      <textarea
        className="pleros-input"
        placeholder="POD notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        style={{ width: '100%', marginBottom: 8 }}
      />
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginBottom: 12 }}>
        <input type="checkbox" checked={ageConfirmed} onChange={(e) => setAgeConfirmed(e.target.checked)} />
        <span>
          Recipient age confirmed (required when the stop includes age-restricted products)
        </span>
      </label>
      {(route?.stops ?? []).map((s) => (
        <div key={s.id} className="pleros-mobile-card">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>Stop #{s.sequence}</strong>
            <span style={{ fontSize: 12 }}>{s.status}</span>
          </div>
          {s.address && <p style={{ fontSize: 13, opacity: 0.7 }}>{typeof s.address === 'string' ? s.address : JSON.stringify(s.address)}</p>}
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
