import { Link } from 'react-router-dom'
import { storefrontAdminHref } from '@/lib/admin-path'
import { useParams } from 'react-router-dom'
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
      await load()
    } catch (e: unknown) {
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
    <main className="cosmos-shop-page-main">
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <Link to="/quotes" className="cosmos-shop-link-accent" style={{ fontSize: 13 }}>
          ← All quotes
        </Link>
        <Link to="/login" className="cosmos-shop-link-accent" style={{ fontSize: 13 }}>
          Re-authenticate →
        </Link>
      </div>
      {err ? <p className="cosmos-shop-error" style={{ marginTop: 16 }}>{err}</p> : null}
      {!q && !err ? <p className="cosmos-shop-muted" style={{ marginTop: 24 }}>Loading…</p> : null}
      {q ? (
        <div style={{ marginTop: 24 }}>
          <h1 style={{ fontSize: 22, color: 'var(--c-heading)' }}>Quote · {q.id.slice(0, 12)}…</h1>
          <p className="cosmos-shop-muted" style={{ marginTop: 8 }}>
            <strong style={{ color: 'var(--c-text)' }}>{q.customerRef}</strong> · {q.status}
            {q.createdAt ? ` · ${new Date(q.createdAt).toLocaleString()}` : ''}
          </p>
          {q.notes ? (
            <p className="cosmos-shop-subtle" style={{ marginTop: 12, fontSize: 14, whiteSpace: 'pre-wrap' }}>
              {q.notes}
            </p>
          ) : null}
          {q.convertedOrderId ? (
            <p className="cosmos-shop-inset">
              <span className="cosmos-shop-muted" style={{ fontSize: 12 }}>Order created · </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{q.convertedOrderId}</span>{' '}
              <a
                href={storefrontAdminHref(`/orders/${encodeURIComponent(q.convertedOrderId)}`)}
                className="cosmos-shop-link-accent"
                style={{ fontSize: 13 }}
                target={ADMIN_BASE ? '_blank' : undefined}
                rel={ADMIN_BASE ? 'noreferrer' : undefined}
              >
                Open in Admin →
              </a>
            </p>
          ) : null}
          {q.status === 'OPEN' ? (
            <button type="button" disabled={busy} onClick={() => void submit()} className="btn-primary" style={{ marginTop: 20 }}>
              {busy ? 'Submitting…' : 'Submit quote (admin)'}
            </button>
          ) : null}
          <h2 style={{ fontSize: 16, marginTop: 28, marginBottom: 12, color: 'var(--c-heading)' }}>Lines</h2>
          <table className="cosmos-shop-table">
            <thead>
              <tr>
                <th>#</th>
                <th>SKU</th>
                <th>Desc</th>
                <th>Qty</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {q.lines.map((ln) => (
                <tr key={ln.id}>
                  <td>{ln.lineNo}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{ln.skuCode ?? '—'}</td>
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
