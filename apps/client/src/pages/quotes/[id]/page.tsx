import { Link, useParams } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'
import { StatusBadge } from '@/components/status-badge'

type Line = {
  id: string
  lineNo: number
  skuCode?: string | null
  description: string
  qty: number
  unitPrice: string | number
}

type CounterOffer = {
  id: string
  offeredBy: string
  status: string
  notes?: string | null
  createdAt: string
  lines: Array<{ lineNo: number; qty: number; unitPrice: string | number }>
}

type QuoteDetail = {
  id: string
  status: string
  customerRef: string
  convertedOrderId?: string | null
  rejectionReason?: string | null
  notes?: string | null
  createdAt?: string
  lines: Line[]
}

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const [q, setQ] = useState<QuoteDetail | null>(null)
  const [offers, setOffers] = useState<CounterOffer[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [counterOpen, setCounterOpen] = useState(false)
  const [counterNotes, setCounterNotes] = useState('')
  const [counterLines, setCounterLines] = useState<Record<number, { qty: string; unitPrice: string }>>({})

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [data, co] = await Promise.all([
        api.get<QuoteDetail>(`/quotes/${id}`),
        api.get<CounterOffer[]>(`/quotes/${id}/counter-offers`).catch(() => [] as CounterOffer[]),
      ])
      setQ(data)
      setOffers(co)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    }
  }, [id])

  useEffect(() => {
    if (id) void load()
  }, [id, load])

  function openCounterForm() {
    if (!q) return
    setCounterLines(
      Object.fromEntries(
        q.lines.map((ln) => [ln.lineNo, { qty: String(ln.qty), unitPrice: String(Number(ln.unitPrice)) }]),
      ),
    )
    setCounterNotes('')
    setCounterOpen(true)
  }

  async function submitCounter() {
    if (!q) return
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/quotes/${id}/counter-offers`, {
        offeredBy: 'BUYER',
        notes: counterNotes.trim() || undefined,
        lines: q.lines.map((ln) => ({
          lineNo: ln.lineNo,
          qty: Number.parseInt(counterLines[ln.lineNo]?.qty ?? String(ln.qty), 10),
          unitPrice: Number.parseFloat(counterLines[ln.lineNo]?.unitPrice ?? String(ln.unitPrice)),
        })),
      })
      setCounterOpen(false)
      await load()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function acceptOffer(counterOfferId: string) {
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/quotes/${id}/counter-offers/accept`, { counterOfferId })
      await load()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function requestApproval() {
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/quotes/${id}/request-approval`, {})
      await load()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function placeOrder() {
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/quotes/${id}/submit`, {})
      await load()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  const canCounter = q && ['OPEN', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED'].includes(q.status)

  return (
    <main className="pleros-shop-page-main">
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <Link to="/quotes" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
          ← All quotes
        </Link>
        <Link to="/login" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
          Re-authenticate →
        </Link>
      </div>
      {err ? (
        <p className="pleros-shop-error" style={{ marginTop: 16 }}>
          {err}
        </p>
      ) : null}
      {!q && !err ? (
        <p className="pleros-shop-muted" style={{ marginTop: 24 }}>
          Loading…
        </p>
      ) : null}
      {q ? (
        <div style={{ marginTop: 24 }}>
          <h1 style={{ fontSize: 22, color: 'var(--c-heading)' }}>Quote · {q.id.slice(0, 12)}…</h1>
          <p className="pleros-shop-muted" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ color: 'var(--c-text)' }}>{q.customerRef.slice(0, 16)}…</strong>
            <StatusBadge status={q.status} />
            {q.createdAt ? ` · ${new Date(q.createdAt).toLocaleString()}` : ''}
          </p>
          {q.rejectionReason ? (
            <p className="pleros-shop-error" style={{ marginTop: 12, fontSize: 14 }}>
              Rejected: {q.rejectionReason}
            </p>
          ) : null}
          {q.notes ? (
            <p className="pleros-shop-subtle" style={{ marginTop: 12, fontSize: 14, whiteSpace: 'pre-wrap' }}>
              {q.notes}
            </p>
          ) : null}
          {q.convertedOrderId ? (
            <p className="pleros-shop-inset">
              <span className="pleros-shop-muted" style={{ fontSize: 12 }}>
                Order created ·{' '}
              </span>
              <Link to={`/orders/${q.convertedOrderId}`} className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
                View order →
              </Link>
            </p>
          ) : null}
          <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {q.status === 'OPEN' || q.status === 'REJECTED' ? (
              <button type="button" disabled={busy} onClick={() => void requestApproval()} className="btn-primary">
                {busy ? 'Submitting…' : 'Submit for approval'}
              </button>
            ) : null}
            {q.status === 'PENDING_APPROVAL' ? (
              <p className="pleros-shop-muted" style={{ fontSize: 14 }}>
                Awaiting admin approval…
              </p>
            ) : null}
            {q.status === 'APPROVED' ? (
              <button type="button" disabled={busy} onClick={() => void placeOrder()} className="btn-primary">
                {busy ? 'Placing order…' : 'Place order'}
              </button>
            ) : null}
            {canCounter ? (
              <button type="button" disabled={busy} onClick={openCounterForm} className="btn-ghost">
                Propose counter-offer
              </button>
            ) : null}
          </div>

          {offers.length > 0 ? (
            <div className="pleros-card" style={{ marginTop: 24, padding: 16 }}>
              <h2 style={{ fontSize: 16, margin: '0 0 12px', color: 'var(--c-heading)' }}>Counter-offers</h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
                {offers.map((o) => (
                  <li
                    key={o.id}
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      border: '1px solid var(--c-border)',
                    }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>
                        {o.offeredBy === 'BUYER' ? 'Your offer' : 'Admin counter'} ·{' '}
                        <StatusBadge status={o.status} />
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
                        {new Date(o.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {o.notes ? (
                      <p style={{ fontSize: 13, color: 'var(--c-text-3)', marginTop: 8 }}>{o.notes}</p>
                    ) : null}
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--c-text-2)' }}>
                      {o.lines.map((ln) => (
                        <li key={ln.lineNo}>
                          Line {ln.lineNo}: {ln.qty} × ${Number(ln.unitPrice).toFixed(2)}
                        </li>
                      ))}
                    </ul>
                    {o.status === 'OPEN' && o.offeredBy === 'ADMIN' ? (
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ marginTop: 10, fontSize: 13 }}
                        disabled={busy}
                        onClick={() => void acceptOffer(o.id)}
                      >
                        Accept counter
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h2 style={{ fontSize: 16, marginTop: 28, marginBottom: 12, color: 'var(--c-heading)' }}>Lines</h2>
          <table className="pleros-shop-table">
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

      {counterOpen && q ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setCounterOpen(false)}
        >
          <div className="pleros-card max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, color: 'var(--c-heading)' }}>Propose counter-offer</h3>
            <p style={{ fontSize: 13, color: 'var(--c-text-3)' }}>Adjust quantities or unit prices per line.</p>
            <textarea
              className="pleros-input min-h-[60px] mt-3"
              placeholder="Notes (optional)"
              value={counterNotes}
              onChange={(e) => setCounterNotes(e.target.value)}
            />
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 16, display: 'grid', gap: 10 }}>
              {q.lines.map((ln) => (
                <li key={ln.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{ln.description}</span>
                  <input
                    type="number"
                    className="pleros-input"
                    style={{ width: 64 }}
                    value={counterLines[ln.lineNo]?.qty ?? ''}
                    onChange={(e) =>
                      setCounterLines((prev) => ({
                        ...prev,
                        [ln.lineNo]: { ...prev[ln.lineNo], qty: e.target.value, unitPrice: prev[ln.lineNo]?.unitPrice ?? String(ln.unitPrice) },
                      }))
                    }
                  />
                  <input
                    type="number"
                    step="0.01"
                    className="pleros-input"
                    style={{ width: 88 }}
                    value={counterLines[ln.lineNo]?.unitPrice ?? ''}
                    onChange={(e) =>
                      setCounterLines((prev) => ({
                        ...prev,
                        [ln.lineNo]: { qty: prev[ln.lineNo]?.qty ?? String(ln.qty), unitPrice: e.target.value },
                      }))
                    }
                  />
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={() => setCounterOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void submitCounter()}>
                {busy ? 'Sending…' : 'Submit counter'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
