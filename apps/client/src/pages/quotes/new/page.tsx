import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useQueryParams } from '@/lib/use-query-params'
import { Suspense, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { clearCart, readCart } from '@/lib/b2b-cart'
import { quoteLinesProblem, type QuoteLineDraft } from '@/lib/quote-lines'
import { QuoteLinesEditor } from '@/components/quotes/quote-lines-editor'

export default function NewQuotePage() {
  return (
    <Suspense
      fallback={
        <main className="pleros-shop-page" style={{ color: 'var(--c-text-3)' }}>
          Loading…
        </main>
      }
    >
      <NewQuoteForm />
    </Suspense>
  )
}

function NewQuoteForm() {
  const navigate = useNavigate()
  const searchParams = useQueryParams()
  const [customerRef, setCustomerRef] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<QuoteLineDraft[]>([
    { lineNo: 1, skuCode: '', description: 'Item', qty: '1', unitPrice: '0' },
  ])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api
      .get<{ customerId: string | null; customerName: string | null }>('/auth/me')
      .then((me) => {
        if (me.customerId) setCustomerRef(me.customerId)
      })
      .catch(() => undefined) // swallow-ok: only pre-fills the customer; the buyer can still pick one
  }, [])

  useEffect(() => {
    if (searchParams.get('from') !== 'cart') return
    const cartLines = readCart()
    if (cartLines.length === 0) return
    setLines(
      cartLines.map((l, i) => ({
        lineNo: i + 1,
        skuCode: l.skuCode,
        description: l.description,
        qty: String(l.qty),
        unitPrice: String(l.unitPrice),
      })),
    )
  }, [searchParams])

  const submit = async () => {
    const problem = quoteLinesProblem(lines)
    if (problem) {
      setErr(problem)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const body = {
        customerRef: customerRef.trim(),
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({
          lineNo: l.lineNo,
          skuCode: l.skuCode.trim(),
          description: l.description.trim(),
          qty: Math.max(1, Number.parseInt(l.qty, 10) || 1),
          unitPrice: Number.parseFloat(l.unitPrice) || 0,
        })),
      }
      const created = await api.post<{ id: string }>('/quotes', body)
      if (searchParams.get('from') === 'cart') clearCart()
      navigate(`/quotes/${created.id}`)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Create failed — check auth and gateway.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="pleros-shop-page" style={{ color: 'var(--c-text)' }}>
      <Link to="/quotes" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
        ← All quotes
      </Link>
      <h1 style={{ marginTop: 20, color: 'var(--c-heading)' }}>New quote</h1>
      <p className="pleros-shop-muted" style={{ fontSize: 14 }}>
        Use{' '}
        <Link to="/catalog" className="pleros-shop-link-accent">
          Catalog
        </Link>{' '}
        +{' '}
        <Link to="/cart" className="pleros-shop-link-accent">
          Cart
        </Link>{' '}
        to pre-fill lines, or search for a product on each line. <strong style={{ color: 'var(--c-text)' }}>Every line needs a product.</strong>
      </p>
      {err ? <p className="pleros-shop-error" style={{ marginTop: 12 }}>{err}</p> : null}
      <label style={{ display: 'block', marginTop: 20, fontSize: 13 }}>
        Customer account
        <input readOnly className="pleros-shop-field pleros-shop-field--mono pleros-shop-field--readonly" value={customerRef} />
      </label>
      <label style={{ display: 'block', marginTop: 16, fontSize: 13 }}>
        Notes
        <textarea rows={3} className="pleros-shop-field" style={{ resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 15, color: 'var(--c-heading)' }}>Lines</h2>
        <QuoteLinesEditor lines={lines} onChange={setLines} />
      </div>
      <button type="button" disabled={busy} onClick={() => void submit()} className="btn-primary" style={{ marginTop: 28 }}>
        {busy ? 'Creating…' : 'Create draft quote'}
      </button>
    </main>
  )
}
