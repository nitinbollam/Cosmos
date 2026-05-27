import { Link } from 'react-router-dom'
import { storefrontAdminHref } from '@/lib/admin-path'
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
    <main className="cosmos-shop-page-main">
      <Link to="/orders" className="cosmos-shop-link-accent" style={{ fontSize: 13 }}>
        ← All orders
      </Link>
      {loading ? <p className="cosmos-shop-muted" style={{ marginTop: 24 }}>Loading…</p> : null}
      {err ? (
        <p className="cosmos-shop-error" style={{ marginTop: 24 }}>
          {err}{' '}
          <Link to="/login" className="cosmos-shop-link-accent">
            Sign in
          </Link>
        </p>
      ) : null}
      {o ? (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
            <h1 style={{ fontSize: 22, margin: 0, color: 'var(--c-heading)' }}>Order · {o.id.slice(0, 12)}…</h1>
            <div style={{ fontSize: 13 }}>
              <a
                href={storefrontAdminHref(`/orders/${encodeURIComponent(o.id)}`)}
                className="cosmos-shop-link-accent"
                target={ADMIN_BASE ? '_blank' : undefined}
                rel={ADMIN_BASE ? 'noreferrer' : undefined}
              >
                Open in Cosmos Admin
              </a>
            </div>
          </div>
          <p style={{ color: 'var(--c-text-3)', marginTop: 10, fontSize: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <StatusBadge status={o.status} /> · {o.channel} · ${Number(o.totalAmount).toFixed(2)}
            {o.createdAt ? ` · ${new Date(o.createdAt).toLocaleString()}` : ''}
          </p>
          {o.notes ? (
            <p className="cosmos-shop-subtle" style={{ marginTop: 12, whiteSpace: 'pre-wrap', fontSize: 14 }}>
              {o.notes}
            </p>
          ) : null}
          <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {o.status === 'PENDING' ? (
              <button type="button" disabled={actionBusy} onClick={() => void confirm()} className="btn-primary">
                {actionBusy ? '…' : 'Confirm order'}
              </button>
            ) : null}
            {o.status !== 'CANCELLED' && o.status !== 'DELIVERED' ? (
              <button type="button" disabled={actionBusy} onClick={() => void cancel()} className="btn-ghost" style={{ color: 'var(--c-danger)', borderColor: 'var(--c-danger)' }}>
                Request cancel
              </button>
            ) : null}
          </div>
          <h2 style={{ fontSize: 16, marginTop: 28, color: 'var(--c-heading)' }}>Line items</h2>
          <table className="cosmos-shop-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>WH</th>
              </tr>
            </thead>
            <tbody>
              {o.lineItems.map((li) => (
                <tr key={li.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{li.skuId}</td>
                  <td>{li.quantity}</td>
                  <td>${Number(li.unitPrice).toFixed(4)}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{li.warehouseId.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  )
}
