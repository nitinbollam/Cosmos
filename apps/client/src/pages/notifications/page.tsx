import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'
import { jwtEmail } from '@/lib/jwt'
import { EmptyState } from '@/components/pleros/empty-state'

type NotificationRow = {
  id: string
  channel: string
  recipient: string
  templateKey: string
  payload?: Record<string, unknown> | null
  status: string
  errorMessage?: string | null
  createdAt: string
}

const TEMPLATE_LABELS: Record<string, string> = {
  'order.created': 'Order confirmation',
  'order.shipped': 'Order shipped',
  'invoice.issued': 'Invoice ready',
  'payment.received': 'Payment received',
  'inventory.low_stock': 'Low stock alert',
}

function templateLabel(key: string) {
  return TEMPLATE_LABELS[key] ?? key.replace(/\./g, ' · ')
}

function templateSummary(row: NotificationRow) {
  const p = row.payload ?? {}
  switch (row.templateKey) {
    case 'order.created':
      return `Order placed for $${String(p.total ?? '—')}.`
    case 'order.shipped': {
      const oid = String(p.orderId ?? '')
      const code = oid.startsWith('seed_ord_') ? `ORD-${oid.replace('seed_ord_', '').toUpperCase()}` : `ORD-${oid.slice(-6).toUpperCase()}`
      return `Order #${code} is on its way.`
    }
    case 'invoice.issued':
      return `Invoice ${String(p.invoiceNumber ?? '—')} for $${String(p.total ?? '—')}${p.dueAt ? ` · due ${String(p.dueAt)}` : ''}.`
    case 'payment.received':
      return `Payment of $${String(p.amount ?? '—')} received${p.invoiceNumber ? ` for ${String(p.invoiceNumber)}` : ''}.`
    default:
      return null
  }
}

export default function BuyerNotificationsPage() {
  const [email, setEmail] = useState<string | null>(null)
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('pleros.accessToken') : null
    const userEmail = jwtEmail(token)
    setEmail(userEmail)
    if (!userEmail) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const data = await api.get<NotificationRow[]>(
        `/notifications?recipient=${encodeURIComponent(userEmail)}`,
      )
      setRows(data)
    } catch (e) {
      setErr(axiosErr(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function retryNotification(id: string) {
    setRetryingId(id)
    setErr(null)
    try {
      await api.post('/notifications/retry', { id })
      await load()
    } catch (e) {
      setErr(axiosErr(e))
    } finally {
      setRetryingId(null)
    }
  }

  const sorted = useMemo(
    () => [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [rows],
  )

  if (!email) {
    return (
      <div className="pleros-shop-page">
        <h1 className="pleros-shop-title">Notifications</h1>
        <EmptyState
          icon="🔔"
          title="Sign in to view notifications"
          description="Order updates, invoices, and payment confirmations appear here."
          action={
            <Link to="/login" className="btn-primary">
              Sign in
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="pleros-shop-page max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="pleros-shop-title">Notifications</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>
            Messages sent to <span className="font-mono">{email}</span>
          </p>
        </div>
        <button type="button" className="btn-ghost !text-sm" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {err && (
        <p className="text-sm mb-4" style={{ color: 'var(--c-danger)' }}>
          {err}
        </p>
      )}

      {loading ? (
        <div className="skeleton h-32 w-full rounded-xl" />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon="📭"
          title="No notifications yet"
          description="When orders ship or invoices are issued, you'll see them here."
        />
      ) : (
        <ul className="space-y-3">
          {sorted.map((row) => {
            const summary = templateSummary(row)
            return (
              <li key={row.id} className="pleros-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-pleros-white">{templateLabel(row.templateKey)}</p>
                    {summary ? (
                      <p className="text-sm mt-1" style={{ color: 'var(--c-text-2)' }}>
                        {summary}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className="text-xs px-2 py-1 rounded-full"
                    style={{
                      background: row.status === 'SENT' ? 'rgba(16,185,129,0.15)' : 'var(--c-surface-2)',
                      color: row.status === 'SENT' ? 'var(--c-success)' : 'var(--c-text-3)',
                    }}
                  >
                    {row.status}
                  </span>
                </div>
                <p className="text-xs mt-3" style={{ color: 'var(--c-text-3)' }}>
                  {new Date(row.createdAt).toLocaleString()} · {row.channel}
                  {row.errorMessage ? (
                    <span style={{ display: 'block', color: 'var(--c-danger)', marginTop: 4 }}>{row.errorMessage}</span>
                  ) : null}
                </p>
                {row.status === 'FAILED' ? (
                  <button
                    type="button"
                    className="btn-ghost !text-xs !py-1 !px-2 mt-3"
                    disabled={retryingId === row.id}
                    onClick={() => void retryNotification(row.id)}
                  >
                    {retryingId === row.id ? 'Retrying…' : 'Retry delivery'}
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
