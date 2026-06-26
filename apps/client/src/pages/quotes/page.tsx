import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type Quote = {
  id: string
  status: string
  customerRef: string
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
        <h1 style={{ color: 'var(--c-heading)', margin: 0 }}>Quotes</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13 }}>
          <Link to="/quotes/new" className="pleros-shop-link-accent">
            + New quote →
          </Link>
          <Link to="/login" className="pleros-shop-link-accent">
            Re-authenticate →
          </Link>
        </div>
      </div>
      {err ? <p className="pleros-shop-error">{err}</p> : null}
      {rows?.length === 0 && <p className="pleros-shop-muted" style={{ marginTop: 16 }}>No quotes yet — try New quote.</p>}
      <ul style={{ padding: 0, listStyle: 'none', marginTop: 20 }}>
        {(rows ?? []).map((q) => (
          <li key={q.id} className="pleros-shop-list-card">
            <Link
              to={`/quotes/${q.id}`}
              className="pleros-shop-link-accent"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            >
              {q.id.slice(0, 14)}… →
            </Link>
            <div>{q.customerRef}</div>
            <div className="pleros-shop-muted" style={{ fontSize: 12 }}>
              Status <strong style={{ color: 'var(--c-text)' }}>{q.status}</strong>
            </div>
          </li>
        ))}
      </ul>
      {!rows && !err ? <p className="pleros-shop-muted">Loading…</p> : null}
    </main>
  )
}
