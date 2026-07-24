import { Link, useParams } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'
import { StatusBadge } from '@/components/status-badge'
import { StorefrontCardCapture } from '@/components/checkout-card-capture'

type Line = {
  id: string
  skuId: string
  quantity: number
  unitPrice: string | number
}

type CreditMemo = {
  id: string
  memoNumber: string
  totalAmount: string | number
  reason?: string | null
  createdAt: string
}

type InvoiceDetail = {
  id: string
  orderId: string
  invoiceNumber: string
  displayStatus: string
  subtotal: string | number
  taxAmount: string | number
  totalAmount: string | number
  amountPaid: string | number
  balance: number
  issuedAt: string
  dueAt?: string | null
  order: { lineItems: Line[]; paymentMethod: string }
  creditMemos: CreditMemo[]
}

const stripePublishable = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? ''

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function InvoicePayPanel({
  invoiceId,
  balance,
  onPaid,
}: {
  invoiceId: string
  balance: number
  onPaid: () => void
}) {
  const [mode, setMode] = useState<'CARD' | 'MANUAL'>('CARD')
  const [payAmount, setPayAmount] = useState(balance.toFixed(2))
  const [payMethod, setPayMethod] = useState<'ACH' | 'CHECK' | 'CASH'>('ACH')
  const [cardPaymentMethodId, setCardPaymentMethodId] = useState<string | null>(null)
  const [payBusy, setPayBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const stripePromise = useMemo(() => (stripePublishable ? loadStripe(stripePublishable) : null), [])

  async function payManual() {
    const amount = Number.parseFloat(payAmount)
    if (!Number.isFinite(amount) || amount <= 0) return
    setPayBusy(true)
    setErr(null)
    try {
      await api.post(`/invoices/${encodeURIComponent(invoiceId)}/payments`, { amount, method: payMethod })
      onPaid()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setPayBusy(false)
    }
  }

  async function payStripe() {
    if (!cardPaymentMethodId) {
      setErr('Save your card first.')
      return
    }
    const amount = Number.parseFloat(payAmount)
    if (!Number.isFinite(amount) || amount <= 0) return
    setPayBusy(true)
    setErr(null)
    try {
      const correlationId = crypto.randomUUID()
      await api.post(`/invoices/${encodeURIComponent(invoiceId)}/pay/stripe`, {
        paymentMethodId: cardPaymentMethodId,
        amount,
        correlationId,
      })
      onPaid()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setPayBusy(false)
    }
  }

  return (
    <div className="pleros-card" style={{ marginTop: 16, padding: 16 }}>
      <h2 style={{ fontSize: 16, margin: '0 0 12px', color: 'var(--c-heading)' }}>Pay invoice</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" className={mode === 'CARD' ? 'btn-primary' : 'btn-ghost'} onClick={() => setMode('CARD')}>
          Card (Stripe)
        </button>
        <button type="button" className={mode === 'MANUAL' ? 'btn-primary' : 'btn-ghost'} onClick={() => setMode('MANUAL')}>
          Record payment
        </button>
      </div>
      <input
        className="pleros-input"
        type="number"
        min="0.01"
        step="0.01"
        value={payAmount}
        onChange={(e) => setPayAmount(e.target.value)}
        style={{ maxWidth: 140, marginBottom: 12 }}
      />
      {mode === 'MANUAL' ? (
        <>
          <select className="pleros-input" value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)} style={{ maxWidth: 160, marginBottom: 12 }}>
            <option value="ACH">ACH</option>
            <option value="CHECK">Check</option>
            <option value="CASH">Cash</option>
          </select>
          <button type="button" className="btn-primary" disabled={payBusy} onClick={() => void payManual()}>
            {payBusy ? 'Processing…' : 'Record payment'}
          </button>
        </>
      ) : stripePromise ? (
        <Elements stripe={stripePromise} options={{ appearance: { theme: 'stripe' } }}>
          <StorefrontCardCapture onPaymentMethodId={setCardPaymentMethodId} />
          <button type="button" className="btn-primary" style={{ marginTop: 12 }} disabled={payBusy || !cardPaymentMethodId} onClick={() => void payStripe()}>
            {payBusy ? 'Processing…' : 'Pay with card'}
          </button>
        </Elements>
      ) : (
        <p className="pleros-shop-muted" style={{ fontSize: 13 }}>Set VITE_STRIPE_PUBLISHABLE_KEY for card payments.</p>
      )}
      {err ? <p className="pleros-shop-error" style={{ marginTop: 8 }}>{err}</p> : null}
    </div>
  )
}

export default function StorefrontInvoiceDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setErr(null)
    try {
      const row = await api.get<InvoiceDetail>(`/invoices/${encodeURIComponent(id)}`)
      setInvoice(row)
    } catch (e: unknown) {
      setErr(axiosErr(e))
      setInvoice(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function downloadPdf() {
    const token = localStorage.getItem('pleros.accessToken')
    const res = await fetch(`/api/v1/invoices/${encodeURIComponent(id)}/pdf`, {
      headers: {
        Accept: 'application/pdf',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!res.ok) {
      setErr('Could not download invoice')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${invoice?.invoiceNumber ?? 'invoice'}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  const inv = invoice

  return (
    <main className="pleros-shop-page-main">
      <Link to="/invoices" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
        ← All invoices
      </Link>
      {loading ? <p className="pleros-shop-muted" style={{ marginTop: 24 }}>Loading…</p> : null}
      {err ? <p className="pleros-shop-error" style={{ marginTop: 24 }}>{err}</p> : null}
      {inv ? (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
            <h1 style={{ fontSize: 22, margin: 0, color: 'var(--c-heading)' }}>{inv.invoiceNumber}</h1>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <StatusBadge status={inv.displayStatus} />
              <button type="button" className="btn-ghost" onClick={() => void downloadPdf()}>
                Download PDF
              </button>
            </div>
          </div>
          <p className="pleros-shop-muted" style={{ marginTop: 10, fontSize: 14 }}>
            Issued {new Date(inv.issuedAt).toLocaleDateString()}
            {inv.dueAt ? ` · Due ${new Date(inv.dueAt).toLocaleDateString()}` : ''}
            {' · '}
            <Link to={`/orders/${inv.orderId}`} className="pleros-shop-link-accent">
              View order
            </Link>
          </p>

          <div className="pleros-card" style={{ marginTop: 20, padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
              <div>
                <div className="pleros-shop-muted" style={{ fontSize: 12 }}>Subtotal</div>
                <div style={{ fontWeight: 600 }}>{money(Number(inv.subtotal))}</div>
              </div>
              <div>
                <div className="pleros-shop-muted" style={{ fontSize: 12 }}>Tax</div>
                <div style={{ fontWeight: 600 }}>{money(Number(inv.taxAmount))}</div>
              </div>
              <div>
                <div className="pleros-shop-muted" style={{ fontSize: 12 }}>Total</div>
                <div style={{ fontWeight: 600 }}>{money(Number(inv.totalAmount))}</div>
              </div>
              <div>
                <div className="pleros-shop-muted" style={{ fontSize: 12 }}>Balance due</div>
                <div style={{ fontWeight: 700, color: inv.balance > 0 ? 'var(--c-warning)' : 'var(--c-success)' }}>
                  {money(inv.balance)}
                </div>
              </div>
            </div>
          </div>

          {inv.balance > 0.01 ? (
            <InvoicePayPanel invoiceId={inv.id} balance={inv.balance} onPaid={() => void load()} />
          ) : null}

          <h2 style={{ fontSize: 16, marginTop: 28, color: 'var(--c-heading)' }}>Line items</h2>
          <table className="pleros-shop-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {inv.order.lineItems.map((li) => (
                <tr key={li.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{li.skuId.slice(0, 12)}…</td>
                  <td>{li.quantity}</td>
                  <td>{money(Number(li.unitPrice))}</td>
                  <td>{money(Number(li.unitPrice) * li.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {inv.creditMemos.length > 0 ? (
            <>
              <h2 style={{ fontSize: 16, marginTop: 28, color: 'var(--c-heading)' }}>Credit memos</h2>
              <ul style={{ paddingLeft: 18, color: 'var(--c-text-2)', fontSize: 14 }}>
                {inv.creditMemos.map((cm) => (
                  <li key={cm.id}>
                    {cm.memoNumber} — {money(Number(cm.totalAmount))}
                    {cm.reason ? ` (${cm.reason})` : ''}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </main>
  )
}
