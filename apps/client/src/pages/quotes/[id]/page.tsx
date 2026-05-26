import { Link } from 'react-router-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'

type Line = {
  id: string
  lineNo: number
  skuCode?: string | null
  description: string
  qty: number
  unitPrice: string | number
}

type QuoteDetail = {
  id: string
  status: string
  customerRef: string
  convertedOrderId?: string | null
  notes?: string | null
  createdAt?: string
  lines: Line[]
}

const ADMIN_BASE = import.meta.env.VITE_WEB_ADMIN_ORIGIN?.replace(/\/$/, '') ?? ''

export default function QuoteDetailPage() {
  const navigate = useNavigate()
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const [q, setQ] = useState<QuoteDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const data = await api.get<QuoteDetail>(`/quotes/${id}`)
      setQ(data)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load quote')
    }
  }, [id])

  useEffect(() => {
    if (id) void load()
  }, [id, load])

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/quotes/${id}/submit`, {})
      await load()} catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: unknown }).message)
          : 'Submit failed (requires TENANT_ADMIN / SUPER_ADMIN on this JWT).'
      setErr(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: '0 20px', color: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <Link to="/quotes" style={{ color: '#93c5fd', fontSize: 13 }}>
          ← All quotes
        </Link>
        <Link to="/login" style={{ color: '#93c5fd', fontSize: 13 }}>
          Re-authenticate →
        </Link>
      </div>
      {err ? <p style={{ color: '#fca5a5', marginTop: 16 }}>{err}</p> : null}
      {!q && !err ? <p style={{ marginTop: 24, color: '#94a3b8' }}>Loading…</p> : null}
      {q ? (
        <div style={{ marginTop: 24 }}>
          <h1 style={{ fontSize: 22 }}>Quote · {q.id.slice(0, 12)}…</h1>
          <p style={{ color: '#94a3b8', marginTop: 8 }}>
            <strong>{q.customerRef}</strong> · {q.status}
            {q.createdAt ? ` · ${new Date(q.createdAt).toLocaleString()}` : ''}
          </p>
          {q.notes ? (
            <p style={{ marginTop: 12, fontSize: 14, whiteSpace: 'pre-wrap', color: '#cbd5f5' }}>
              {q.notes}
            </p>
          ) : null}
          {q.convertedOrderId ? (
            <p style={{ marginTop: 16, padding: 12, borderRadius: 10, background: '#0f172a', border: '1px solid #334155' }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>Order created · </span>
              <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{q.convertedOrderId}</span>
              {ADMIN_BASE ? (
                <>
                  {' '}
                  <a
                    to={`${ADMIN_BASE}/orders/${encodeURIComponent(q.convertedOrderId)}`}
                    style={{ color: '#93c5fd', fontSize: 13 }}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Admin →
                  </a>
                </>
              ) : (
                <span style={{ marginLeft: 8, fontSize: 12, color: '#64748b' }}>
                  Set NEXT_PUBLIC_WEB_ADMIN_ORIGIN to deep-link Cosmos Admin orders.
                </span>
              )}
            </p>
          ) : null}
          {q.status === 'OPEN' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              style={{
                marginTop: 20,
                padding: '10px 18px',
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#1e293b',
                color: '#e2e8f0',
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy ? 'Submitting…' : 'Submit quote (admin)'}
            </button>
          ) : null}
          <h2 style={{ fontSize: 16, marginTop: 28, marginBottom: 12 }}>Lines</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#94a3b8' }}>
                <th style={{ padding: '8px 0' }}>#</th>
                <th>SKU</th>
                <th>Desc</th>
                <th>Qty</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {q.lines.map((ln) => (
                <tr key={ln.id} style={{ borderTop: '1px solid #1f2740' }}>
                  <td style={{ padding: '10px 0' }}>{ln.lineNo}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{ln.skuCode ?? '—'}</td>
                  <td>{ln.description}</td>
                  <td>{ln.qty}</td>
                  <td>${Number(ln.unitPrice).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  )
}
