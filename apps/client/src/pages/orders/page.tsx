import { Link, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { isUnauthorized } from '@/lib/axios-error'
import { getB2bCustomerId } from '@/lib/session'
import { StatusBadge } from '@/components/status-badge'
import { useCartStore } from '@/stores/cart.store'

type OrderRow = {
  id: string
  status: string
  channel: string
  customerId: string
  totalAmount: string | number
  createdAt: string
  lineItems?: Array<{ skuId: string; warehouseId: string; quantity: number; unitPrice: string | number }>
}

type OrderPage = {
  items: OrderRow[]
  total: number
  page: number
  pageSize: number
  hasMore?: boolean
}

export default function StorefrontOrdersPage() {
  const navigate = useNavigate()
  const addItems = useCartStore((s) => s.addItems)
  const [data, setData] = useState<OrderPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [unauthorized, setUnauthorized] = useState(false)
  const [otherErr, setOtherErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setOtherErr(null)
    setUnauthorized(false)
    const cid = getB2bCustomerId()
    try {
      const qs = new URLSearchParams({ page: '1', pageSize: '50', channel: 'B2B_PORTAL' })
      if (cid) qs.set('customerId', cid)
      const page = await api.get<OrderPage>(`/orders?${qs.toString()}`)
      setData(page)
    } catch (e: unknown) {
      if (isUnauthorized(e)) setUnauthorized(true)
      else setOtherErr(e instanceof Error ? e.message : 'Failed to load')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function reorder(orderId: string) {
    try {
      const lines = await api.get<Array<{
        skuId: string
        skuCode: string
        skuName: string
        warehouseId: string
        quantity: number
        unitPrice: number
      }>>(`/orders/${encodeURIComponent(orderId)}/reorder-lines`)
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
  }

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--c-heading)', margin: 0 }}>Your orders</h1>
          <p style={{ color: 'var(--c-text-3)', marginTop: 8, fontSize: 14 }}>B2B portal orders for your customer record.</p>
        </div>
        {data && data.items.length > 0 ? (
          <p style={{ fontSize: 13, color: 'var(--c-text-3)', margin: 0 }}>
            {data.total} order{data.total === 1 ? '' : 's'}
          </p>
        ) : null}
      </div>
      {loading ? <p style={{ marginTop: 24, color: 'var(--c-text-3)' }}>Loading…</p> : null}
      {unauthorized ? (
        <p style={{ marginTop: 24, color: 'var(--c-danger)' }}>
          Sign in to view orders.{' '}
          <Link to="/login" style={{ color: 'var(--c-accent)' }}>
            Login →
          </Link>
        </p>
      ) : null}
      {otherErr ? <p style={{ marginTop: 24, color: 'var(--c-danger)' }}>{otherErr}</p> : null}
      {!getB2bCustomerId() && !loading ? (
        <p style={{ marginTop: 16, color: 'var(--c-warning)' }}>
          Complete sign-in to link your CRM customer, or{' '}
          <Link to="/login" style={{ color: 'var(--c-accent)' }}>
            sign in again
          </Link>
          .
        </p>
      ) : null}
      {!loading && data && data.items.length === 0 ? (
        <p style={{ marginTop: 24, color: 'var(--c-text-3)' }}>
          No orders yet.{' '}
          <Link to="/catalog" style={{ color: 'var(--c-accent)' }}>
            Shop catalog →
          </Link>
        </p>
      ) : null}
      {data && data.items.length > 0 ? (
        <div style={{ marginTop: 24, overflowX: 'auto' }}>
          <table className="pleros-table pleros-shop-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Status</th>
                <th>Items</th>
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr
                  key={o.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/orders/${encodeURIComponent(o.id)}`)}
                >
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{o.id.slice(0, 14)}…</td>
                  <td style={{ color: 'var(--c-text-3)', fontSize: 13 }}>{new Date(o.createdAt).toLocaleString()}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td style={{ color: 'var(--c-text-3)', fontSize: 13 }}>{o.lineItems?.length ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>${Number(o.totalAmount).toFixed(2)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to={`/orders/${encodeURIComponent(o.id)}`} style={{ color: 'var(--c-accent)', fontSize: 13 }}>
                      View
                    </Link>
                    {' · '}
                    <button type="button" className="btn-ghost" style={{ fontSize: 13, padding: '2px 8px' }} onClick={() => void reorder(o.id)}>
                      Reorder
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
