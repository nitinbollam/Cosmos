import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { StatusBadge } from '@/components/status-badge'

type Quote = {
  id: string
  quoteNumber?: string
  status: string
  customerRef: string
  customerName?: string
  notes?: string | null
  createdAt?: string
}

export default function QuotesPage() {
  const [rows, setRows] = useState<Quote[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const data = await api.get<Quote[]>('/quotes')
        setRows(data)
      } catch (e) {
        setErr((e as Error).message ?? 'Could not fetch quotes — sign in required?')
      }
    })()
  }, [])

  return (
    <main className="pleros-shop-page-main">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: 'var(--c-heading)', margin: 0 }}>Quotes</h1>
          <p style={{ color: 'var(--c-text-3)', fontSize: 14, margin: '6px 0 0' }}>
            B2B custom pricing quotes and estimates.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13 }}>
          <Link to="/quotes/new" className="btn-primary">
            + New quote
          </Link>
        </div>
      </div>
      {err ? <p className="pleros-shop-error" style={{ marginTop: 16 }}>{err}</p> : null}
      {rows?.length === 0 && (
        <p className="pleros-shop-muted" style={{ marginTop: 24 }}>
          No quotes yet — try creating a new quote.
        </p>
      )}
      <ul style={{ padding: 0, listStyle: 'none', marginTop: 20 }}>
        {(rows ?? []).map((q) => (
          <li
            key={q.id}
            className="pleros-shop-list-card"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 16,
              marginBottom: 12,
            }}
          >
            <div>
              <Link
                to={`/quotes/${q.id}`}
                className="pleros-shop-link-accent"
                style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 14 }}
              >
                {q.quoteNumber || `Quote #${q.id.slice(-8).toUpperCase()}`}
              </Link>
              <div style={{ color: 'var(--c-heading)', fontSize: 14, fontWeight: 500, marginTop: 4 }}>
                {q.customerName || q.customerRef}
              </div>
              {q.notes ? (
                <p style={{ color: 'var(--c-text-3)', fontSize: 12, margin: '4px 0 0' }}>
                  {q.notes}
                </p>
              ) : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <StatusBadge status={q.status} />
              <Link to={`/quotes/${q.id}`} className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
                View →
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {!rows && !err ? <p className="pleros-shop-muted" style={{ marginTop: 24 }}>Loading…</p> : null}
    </main>
  )
}
