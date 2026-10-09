import { Link } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'

type Line = { skuId: string; skuCode?: string | null; skuName?: string | null; quantity: number; unitPrice: string | number }
type OrderDetail = { id: string; status: string; totalAmount: string | number; lineItems: Line[]; notes?: string | null }

function formatOrderNumber(id: string): string {
  if (!id) return ''
  if (id.startsWith('seed_ord_')) {
    return `#ORD-${id.replace('seed_ord_', '').toUpperCase()}`
  }
  return `#ORD-${id.slice(-8).toUpperCase()}`
}

export default function OrderConfirmationPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    void (async () => {
      try {
        const o = await api.get<OrderDetail>(`/orders/${encodeURIComponent(id)}`)
        setOrder(o)
      } catch (e: unknown) {
        setErr(axiosErr(e))
      }
    })()
  }, [id])

  return (
    <div style={{ padding: 48, maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
      <div
        style={{
          width: 80,
          height: 80,
          margin: '0 auto 20px',
          borderRadius: '50%',
          border: `4px solid var(--c-success)`,
          color: 'var(--c-success)',
          fontSize: 42,
          lineHeight: '72px',
          fontWeight: 700,
        }}
      >
        ✓
      </div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32, color: 'var(--c-heading)' }}>Order Confirmed</h1>
      {err ? <p style={{ color: 'var(--c-danger)' }}>{err}</p> : null}
      {order ? (
        <>
          <p style={{ color: 'var(--c-text-2)', marginTop: 12 }}>Order number</p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--c-accent)' }}>
            {formatOrderNumber(order.id)}
          </p>
          <div className="pleros-card mt-6 text-left">
            <h3 style={{ marginTop: 0 }}>Summary</h3>
            {order.lineItems.map((li) => (
              <div key={li.skuId} style={{ fontSize: 14, marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>{li.skuName || li.skuCode || li.skuId.slice(0, 8)}</span> × {li.quantity} — ${(Number(li.unitPrice) * li.quantity).toFixed(2)}
              </div>
            ))}
            <p style={{ fontWeight: 700 }}>Total ${Number(order.totalAmount).toFixed(2)}</p>
          </div>
        </>
      ) : null}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 32, flexWrap: 'wrap' }}>
        <Link to={id ? `/orders/${encodeURIComponent(id)}` : '/orders'} className="btn-primary">
          Track order
        </Link>
        <Link to="/catalog" className="btn-ghost">
          Continue shopping
        </Link>
      </div>
    </div>
  )
}
