import { Link, useParams } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-mobile'
import { axiosErr } from '@/lib/axios-error'
import { creditLabel, creditRequestProblem, money } from '@/lib/rep-app'

type Detail = {
  customer: { id: string; name: string; email?: string; phone?: string; address: string; paymentTermsDays: number }
  credit: { creditLimit: number | null; openBalance: number; availableCredit: number | null }
  pendingCreditRequest: { id: string; context: { requestedLimit?: number } } | null
  recentOrders: Array<{ id: string; status: string; totalAmount: number; createdAt: string }>
  openInvoices: Array<{ id: string; invoiceNumber: string; dueAt?: string | null; balance: number }>
  timeline: Array<{ id: string; type: string; subject?: string | null; occurredAt: string }>
}

export default function RepCustomerPage() {
  const { id } = useParams<{ id: string }>()
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showCredit, setShowCredit] = useState(false)
  const [limit, setLimit] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    try {
      setD(await api.get<Detail>(`/rep/accounts/${encodeURIComponent(id)}`))
    } catch (e) {
      setErr(axiosErr(e))
    }
  }, [id])
  useEffect(() => {
    void load()
  }, [load])

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      await fn()
      setMsg(done)
      await load()
    } catch (e) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  function sendCredit() {
    const problem = creditRequestProblem(limit, reason, d?.credit.creditLimit ?? null)
    if (problem) return setErr(problem)
    void act(async () => {
      await api.post(`/rep/accounts/${encodeURIComponent(id ?? '')}/credit-request`, { requestedLimit: Number(limit), reason: reason.trim() })
      setShowCredit(false)
      setLimit('')
      setReason('')
    }, 'Sent to a manager for approval')
  }

  return (
    <div>
      <Link to="/m/sales" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>← Accounts</Link>
      {err && <p style={{ color: 'var(--c-danger)', fontSize: 13 }}>{err}</p>}
      {msg && <p style={{ color: 'var(--c-success)', fontSize: 13 }}>{msg}</p>}
      {d && (
        <>
          <h1 style={{ fontFamily: 'var(--font-display)', marginBottom: 4 }}>{d.customer.name}</h1>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>{[d.customer.address, d.customer.phone, d.customer.email].filter(Boolean).join(' · ')}</p>

          <div className="pleros-mobile-card" style={{ marginTop: 12 }}>
            <strong>{creditLabel(d.credit)}</strong>
            <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.75 }}>
              Owes {money(d.credit.openBalance)}{d.customer.paymentTermsDays ? ` · net ${d.customer.paymentTermsDays}` : ''}
            </p>
            {d.pendingCreditRequest ? (
              <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                Asked for {money(d.pendingCreditRequest.context.requestedLimit)}. Waiting for a manager.
              </p>
            ) : (
              <button type="button" className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setShowCredit((v) => !v)}>
                Ask for more credit
              </button>
            )}
            {showCredit && !d.pendingCreditRequest && (
              <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                <input className="pleros-input" type="number" inputMode="decimal" placeholder="New limit" value={limit} onChange={(e) => setLimit(e.target.value)} />
                <input className="pleros-input" placeholder="Why does this account need it?" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button type="button" className="btn-primary" disabled={busy} onClick={sendCredit}>Send for approval</button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Link to={`/m/sales/customer/${d.customer.id}/compose?mode=order`} className="btn-primary" style={{ flex: 1, textAlign: 'center' }}>New order</Link>
            <Link to={`/m/sales/customer/${d.customer.id}/compose?mode=quote`} className="btn-ghost" style={{ flex: 1, textAlign: 'center' }}>New quote</Link>
          </div>

          <h2 style={{ fontSize: '1rem', marginTop: 20 }}>Open invoices</h2>
          {d.openInvoices.map((i) => (
            <div key={i.id} className="pleros-mobile-card">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{i.invoiceNumber}</strong><span>{money(i.balance)}</span>
              </div>
              {i.dueAt && <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.7 }}>Due {new Date(i.dueAt).toLocaleDateString()}</p>}
            </div>
          ))}
          {d.openInvoices.length === 0 && <p style={{ opacity: 0.6, fontSize: 13 }}>Nothing open.</p>}

          <h2 style={{ fontSize: '1rem', marginTop: 20 }}>Recent orders</h2>
          {d.recentOrders.map((o) => (
            <div key={o.id} className="pleros-mobile-card">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>#{o.id.slice(-8).toUpperCase()}</strong><span>{money(o.totalAmount)}</span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.7 }}>{o.status.replace(/_/g, ' ')} · {new Date(o.createdAt).toLocaleDateString()}</p>
            </div>
          ))}

          <h2 style={{ fontSize: '1rem', marginTop: 20 }}>Timeline</h2>
          <div className="pleros-mobile-card" style={{ display: 'grid', gap: 8 }}>
            <input className="pleros-input" placeholder="Log a call or note" value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" className="btn-ghost" disabled={busy || !note.trim()}
              onClick={() => void act(async () => {
                await api.post('/activities', { customerId: d.customer.id, type: 'NOTE', subject: note.trim(), occurredAt: new Date().toISOString() })
                setNote('')
              }, 'Logged')}>
              Save note
            </button>
          </div>
          {d.timeline.map((a) => (
            <div key={a.id} className="pleros-mobile-card">
              <strong>{a.subject ?? a.type}</strong>
              <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.7 }}>{a.type} · {new Date(a.occurredAt).toLocaleString()}</p>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
