import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { isUnauthorized } from '@/lib/axios-error'
import { StatusBadge } from '@/components/status-badge'

type InvoiceRow = {
  id: string
  orderId: string
  invoiceNumber: string
  displayStatus: string
  totalAmount: string | number
  amountPaid: string | number
  balance: number
  issuedAt: string
  dueAt?: string | null
}

type InvoiceList = { items: InvoiceRow[]; total: number }

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function StorefrontInvoicesPage() {
  const [data, setData] = useState<InvoiceList | null>(null)
  const [filter, setFilter] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [unauthorized, setUnauthorized] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    setUnauthorized(false)
    try {
      const qs = new URLSearchParams({ page: '1', pageSize: '100' })
      if (filter !== 'ALL') qs.set('status', filter)
      const page = await api.get<InvoiceList>(`/invoices?${qs.toString()}`)
      setData(page)
    } catch (e: unknown) {
      if (isUnauthorized(e)) setUnauthorized(true)
      else setErr(e instanceof Error ? e.message : 'Failed to load invoices')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => data?.items ?? [], [data])

  return (
    <main className="cosmos-shop-page-main">
      <h1 style={{ fontSize: 24, margin: 0, color: 'var(--c-heading)' }}>Invoices</h1>
      <p className="cosmos-shop-muted" style={{ marginTop: 8, fontSize: 14 }}>
        Open balances and payment history for your account.
      </p>

      <div style={{ marginTop: 20, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(['ALL', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={filter === f ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setFilter(f)}
          >
            {f === 'ALL' ? 'All' : f.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {loading ? <p className="cosmos-shop-muted" style={{ marginTop: 24 }}>Loading…</p> : null}
      {unauthorized ? (
        <p className="cosmos-shop-error" style={{ marginTop: 24 }}>
          Sign in to view invoices.{' '}
          <Link to="/login" className="cosmos-shop-link-accent">
            Login →
          </Link>
        </p>
      ) : null}
      {err ? <p className="cosmos-shop-error" style={{ marginTop: 24 }}>{err}</p> : null}

      {!loading && rows.length === 0 && !unauthorized ? (
        <p className="cosmos-shop-muted" style={{ marginTop: 24 }}>No invoices yet.</p>
      ) : null}

      {rows.length > 0 ? (
        <table className="cosmos-shop-table" style={{ marginTop: 24 }}>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Status</th>
              <th>Issued</th>
              <th>Due</th>
              <th>Total</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <Link to={`/invoices/${inv.id}`} className="cosmos-shop-link-accent">
                    {inv.invoiceNumber}
                  </Link>
                </td>
                <td>
                  <StatusBadge status={inv.displayStatus} />
                </td>
                <td>{new Date(inv.issuedAt).toLocaleDateString()}</td>
                <td>{inv.dueAt ? new Date(inv.dueAt).toLocaleDateString() : '—'}</td>
                <td>{money(Number(inv.totalAmount))}</td>
                <td style={{ fontWeight: inv.balance > 0 ? 600 : 400 }}>{money(inv.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  )
}
