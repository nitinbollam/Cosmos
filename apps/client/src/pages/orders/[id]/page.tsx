import { Link } from 'react-router-dom'
import { StatusBadge } from '@/components/status-badge'
import { useParams } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'

type Line = {
  id: string
  skuId: string
  warehouseId: string
  quantity: number
  unitPrice: string | number
}

type OrderDetail = {
  id: string
  status: string
  channel: string
  customerId: string
  totalAmount: string | number
  taxAmount?: string | number
  notes?: string | null
  createdAt: string
  lineItems: Line[]
}

const ADMIN_BASE = import.meta.env.VITE_WEB_ADMIN_ORIGIN?.replace(/\/$/, '') ?? ''

export default function StorefrontOrderDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setErr(null)
    try {
      const o = await api.get<OrderDetail>(`/orders/${encodeURIComponent(id)}`)
      setOrder(o)
    } catch (e: unknown) {
      setErr(axiosErr(e))
      setOrder(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function confirm() {
    if (!id) return
    setActionBusy(true)
    setErr(null)
    try {
      await api.post(`/orders/${encodeURIComponent(id)}/confirm`, {})
      await load()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setActionBusy(false)
    }
  }

  async function cancel() {
    if (!id) return
    const reason = window.prompt('Cancellation reason (required)')?.trim()
    if (!reason) return
    setActionBusy(true)
    setErr(null)
    try {
      await api.post(`/orders/${encodeURIComponent(id)}/cancel`, { reason })
      await load()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setActionBusy(false)
    }
  }

  const o = order

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: '0 20px', color: '#f8fafc' }}>
      <Link to="/orders" style={{ color: '#93c5fd', fontSize: 13 }}>
        ← All orders
      </Link>
      {loading ? <p style={{ marginTop: 24, color: '#94a3b8' }}>Loading…</p> : null}
      {err ? (
        <p style={{ marginTop: 24, color: '#fca5a5' }}>
          {err}{' '}
          <Link to="/login" style={{ color: '#93c5fd' }}>
            Sign in
          </Link>
        </p>
      ) : null}
      {o ? (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
            <h1 style={{ fontSize: 22, margin: 0 }}>Order · {o.id.slice(0, 12)}…</h1>
            <div style={{ fontSize: 13, color: '#94a3b8' }}>
              {ADMIN_BASE ? (
                <a
                  to={`${ADMIN_BASE}/orders/${encodeURIComponent(o.id)}`}
                  style={{ color: '#a78bfa' }}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Cosmos Admin
                </a>
              ) : (
                <span>Set NEXT_PUBLIC_WEB_ADMIN_ORIGIN for admin deep link.</span>
              )}
            </div>
          </div>
          <p style={{ color: 'var(--c-text-3)', marginTop: 10, fontSize: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <StatusBadge status={o.status} /> · {o.channel} · ${Number(o.totalAmount).toFixed(2)}
            {o.createdAt ? ` · ${new Date(o.createdAt).toLocaleString()}` : ''}
          </p>
          {o.notes ? (
            <p style={{ marginTop: 12, whiteSpace: 'pre-wrap', color: '#cbd5e1', fontSize: 14 }}>{o.notes}</p>
          ) : null}
          <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {o.status === 'PENDING' ? (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void confirm()}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  background: '#059669',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {actionBusy ? '…' : 'Confirm order'}
              </button>
            ) : null}
            {o.status !== 'CANCELLED' && o.status !== 'DELIVERED' ? (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void cancel()}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  background: 'transparent',
                  color: '#fca5a5',
                  border: '1px solid #7f1d1d',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Request cancel
              </button>
            ) : null}
          </div>
          <h2 style={{ fontSize: 16, marginTop: 28, color: '#e2e8f0' }}>Line items</h2>
          <table style={{ width: '100%', marginTop: 12, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8', textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>SKU</th>
                <th style={{ padding: '8px 6px' }}>Qty</th>
                <th style={{ padding: '8px 6px' }}>Unit</th>
                <th style={{ padding: '8px 6px' }}>WH</th>
              </tr>
            </thead>
            <tbody>
              {o.lineItems.map((li) => (
                <tr key={li.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontSize: 11 }}>{li.skuId}</td>
                  <td style={{ padding: '8px 6px' }}>{li.quantity}</td>
                  <td style={{ padding: '8px 6px' }}>${Number(li.unitPrice).toFixed(4)}</td>
                  <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontSize: 11 }}>
                    {li.warehouseId.slice(0, 8)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  )
}
