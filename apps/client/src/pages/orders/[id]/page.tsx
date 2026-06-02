import { Link, useNavigate, useParams } from 'react-router-dom'
import { storefrontAdminHref } from '@/lib/admin-path'
import { StatusBadge } from '@/components/status-badge'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'
import { useCartStore } from '@/stores/cart.store'

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

type InvoiceChip = {
  id: string
  invoiceNumber: string
  displayStatus: string
  balance: number
}

type TrackingShipment = {
  id: string
  shipmentNo: number
  status: string
  carrier?: string | null
  trackingNumber?: string | null
  shippedAt?: string | null
}

type TrackingData = {
  orderStatus: string
  shipments: TrackingShipment[]
  delivery: {
    routeId: string
    routeStatus: string
    stopStatus: string
    stopSequence: number
    eta: string | null
  } | null
}

const TRACKABLE_STATUSES = ['PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED']

const ORDER_FLOW = ['PENDING', 'CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'] as const

function trackingUrl(carrier: string | null | undefined, trackingNumber: string | null | undefined): string | null {
  if (!trackingNumber?.trim()) return null
  const num = encodeURIComponent(trackingNumber.trim())
  const c = (carrier ?? '').toLowerCase()
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${num}`
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${num}`
  if (c.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`
  return null
}

const ADMIN_BASE = import.meta.env.VITE_WEB_ADMIN_ORIGIN?.replace(/\/$/, '') ?? ''

export default function StorefrontOrderDetailPage() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const addItems = useCartStore((s) => s.addItems)
  const id = params?.id ?? ''
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [invoice, setInvoice] = useState<InvoiceChip | null>(null)
  const [tracking, setTracking] = useState<TrackingData | null>(null)
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
      if (['SHIPPED', 'DELIVERED', 'RETURNED'].includes(o.status)) {
        try {
          const inv = await api.get<InvoiceChip>(`/orders/${encodeURIComponent(id)}/invoice`)
          setInvoice(inv)
        } catch {
          setInvoice(null)
        }
      } else {
        setInvoice(null)
      }
      if (TRACKABLE_STATUSES.includes(o.status)) {
        try {
          const tr = await api.get<TrackingData>(`/orders/${encodeURIComponent(id)}/tracking`)
          setTracking(tr)
        } catch {
          setTracking(null)
        }
      } else {
        setTracking(null)
      }
    } catch (e: unknown) {
      setErr(axiosErr(e))
      setOrder(null)
      setInvoice(null)
      setTracking(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  function reorder() {
    if (!order) return
    void (async () => {
      try {
        const lines = await api.get<Array<{
          skuId: string
          skuCode: string
          skuName: string
          warehouseId: string
          quantity: number
          unitPrice: number
        }>>(`/orders/${encodeURIComponent(order.id)}/reorder-lines`)
        addItems(
          lines.map((li) => ({
            skuId: li.skuId,
            skuName: li.skuName,
            skuCode: li.skuCode,
            unitPrice: li.unitPrice,
            quantity: li.quantity,
            warehouseId: li.warehouseId,
          })),
        )
        navigate('/cart')
      } catch {
        /* ignore */
      }
    })()
  }

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
  const flowIdx = o ? ORDER_FLOW.indexOf(o.status as (typeof ORDER_FLOW)[number]) : -1

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
            {invoice ? (
              <>
                {' · '}
                <Link to={`/invoices/${invoice.id}`} className="cosmos-shop-link-accent">
                  {invoice.invoiceNumber}
                </Link>
                <StatusBadge status={invoice.displayStatus} />
              </>
            ) : null}
          </p>
          {o.notes ? (
            <p className="cosmos-shop-subtle" style={{ marginTop: 12, whiteSpace: 'pre-wrap', fontSize: 14 }}>
              {o.notes}
            </p>
          ) : null}

          {o.status !== 'CANCELLED' && o.status !== 'FAILED' ? (
            <div className="cosmos-card" style={{ marginTop: 20, padding: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--c-text-3)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Order progress
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                {ORDER_FLOW.map((step, i) => {
                  const done = flowIdx >= i
                  const current = o.status === step
                  return (
                    <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: current ? 700 : 500,
                          padding: '4px 8px',
                          borderRadius: 999,
                          background: done ? 'var(--c-primary-dim)' : 'var(--c-surface-2)',
                          color: done ? 'var(--c-primary)' : 'var(--c-text-3)',
                          border: current ? '1px solid var(--c-primary)' : '1px solid transparent',
                        }}
                      >
                        {step.replace(/_/g, ' ')}
                      </span>
                      {i < ORDER_FLOW.length - 1 ? (
                        <span style={{ color: 'var(--c-border)', fontSize: 10 }}>→</span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {tracking && (tracking.shipments.length > 0 || tracking.delivery) ? (
            <div className="cosmos-card" style={{ marginTop: 20, padding: 16 }}>
              <h2 style={{ fontSize: 16, margin: '0 0 12px', color: 'var(--c-heading)' }}>Shipping &amp; delivery</h2>
              {tracking.delivery ? (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    background: 'var(--c-surface-2)',
                    marginBottom: tracking.shipments.length > 0 ? 16 : 0,
                  }}
                >
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--c-text-2)' }}>
                    <strong>Delivery route</strong> · stop #{tracking.delivery.stopSequence} ·{' '}
                    <StatusBadge status={tracking.delivery.stopStatus} />
                  </p>
                  {tracking.delivery.eta ? (
                    <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--c-accent)' }}>
                      Estimated arrival: {new Date(tracking.delivery.eta).toLocaleString()}
                    </p>
                  ) : (
                    <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--c-text-3)' }}>
                      Route status: {tracking.delivery.routeStatus.replace(/_/g, ' ')}
                    </p>
                  )}
                </div>
              ) : null}
              {tracking.shipments.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                  {tracking.shipments.map((s) => {
                    const url = trackingUrl(s.carrier, s.trackingNumber)
                    return (
                      <li
                        key={s.id}
                        style={{
                          padding: 12,
                          borderRadius: 8,
                          border: '1px solid var(--c-border)',
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'space-between',
                          gap: 8,
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <p style={{ margin: 0, fontSize: 14 }}>
                            Shipment #{s.shipmentNo}
                            {s.carrier ? ` · ${s.carrier}` : ''}
                          </p>
                          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--c-text-3)', fontFamily: 'var(--font-mono)' }}>
                            {s.trackingNumber ?? 'Tracking pending'}
                          </p>
                          {s.shippedAt ? (
                            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--c-text-3)' }}>
                              Shipped {new Date(s.shippedAt).toLocaleString()}
                            </p>
                          ) : null}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <StatusBadge status={s.status} />
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="cosmos-shop-link-accent" style={{ fontSize: 13 }}>
                              Track package →
                            </a>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button type="button" className="btn-primary" onClick={reorder}>
              Reorder
            </button>
            {o.status === 'PENDING' ? (
              <button type="button" disabled={actionBusy} onClick={() => void confirm()} className="btn-ghost">
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
