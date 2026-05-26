import { Link } from 'react-router-dom'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Suspense, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { clearCart, readCart } from '@/lib/b2b-cart'

type QuoteLineDraft = {
  lineNo: number
  skuCode: string
  description: string
  qty: string
  unitPrice: string
}

export default function NewQuotePage() {
  return (
    <Suspense
      fallback={
        <main style={{ maxWidth: 720, margin: '40px auto', padding: '0 20px', color: '#94a3b8' }}>Loading…</main>
      }
    >
      <NewQuoteForm />
    </Suspense>
  )
}

function NewQuoteForm() {
  const navigate = useNavigate()
  const searchParams = useSearchParams()
  const [customerRef, setCustomerRef] = useState('PO-REFERENCE')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<QuoteLineDraft[]>([
    { lineNo: 1, skuCode: '', description: 'Item', qty: '1', unitPrice: '0' },
  ])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    setBusy(true)
    setErr(null)
    try {
      const body = {
        customerRef: customerRef.trim(),
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({
          lineNo: l.lineNo,
          skuCode: l.skuCode.trim() || undefined,
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
    <main style={{ maxWidth: 720, margin: '40px auto', padding: '0 20px', color: '#f8fafc' }}>
      <Link to="/quotes" style={{ color: '#93c5fd', fontSize: 13 }}>
        ← All quotes
      </Link>
      <h1 style={{ marginTop: 20 }}>New quote</h1>
      <p style={{ color: '#94a3b8', fontSize: 14 }}>
        Sends <span style={{ fontFamily: 'monospace' }}>POST /quotes</span> through the gateway. Use{' '}
        <Link to="/catalog" style={{ color: '#93c5fd' }}>
          Catalog
        </Link>{' '}
        +{' '}
        <Link to="/cart" style={{ color: '#93c5fd' }}>
          Cart
        </Link>{' '}
        to pre-fill lines. Admin submit-to-order{' '}
        <strong style={{ color: '#cbd5f5' }}>requires a SKU code on every line.</strong>
      </p>
      {err ? <p style={{ color: '#fca5a5', marginTop: 12 }}>{err}</p> : null}
      <label style={{ display: 'block', marginTop: 20, fontSize: 13 }}>
        Customer ref / PO #
        <input
          style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 8, border: '1px solid #334155', background: '#0d0d16', color: '#e2e8f0' }}
          value={customerRef}
          onChange={(e) => setCustomerRef(e.target.value)}
        />
      </label>
      <label style={{ display: 'block', marginTop: 16, fontSize: 13 }}>
        Notes
        <textarea
          rows={3}
          style={{
            width: '100%',
            marginTop: 6,
            padding: 10,
            borderRadius: 8,
            border: '1px solid #334155',
            background: '#0d0d16',
            color: '#e2e8f0',
            resize: 'vertical',
          }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 15 }}>Lines</h2>
        {lines.map((l, idx) => (
          <div
            key={l.lineNo}
            style={{
              border: '1px solid #1f2740',
              borderRadius: 10,
              padding: 12,
              marginTop: 10,
              display: 'grid',
              gap: 8,
            }}
          >
            <span style={{ color: '#94a3b8', fontSize: 12 }}>
              Line #{l.lineNo}
              <button
                type="button"
                style={{ marginLeft: 12, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}
                onClick={() => setLines(lines.filter((_, i) => i !== idx).map((x, i) => ({ ...x, lineNo: i + 1 })))}
                disabled={lines.length <= 1}
              >
                Remove
              </button>
            </span>
            <input
              placeholder="SKU (optional)"
              style={{ padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0d0d16', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13 }}
              value={l.skuCode}
              onChange={(e) => {
                const next = [...lines]
                next[idx] = { ...l, skuCode: e.target.value }
                setLines(next)
              }}
            />
            <input
              placeholder="Description"
              style={{ padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0d0d16', color: '#e2e8f0' }}
              value={l.description}
              onChange={(e) => {
                const next = [...lines]
                next[idx] = { ...l, description: e.target.value }
                setLines(next)
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                min={1}
                placeholder="Qty"
                style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0d0d16', color: '#e2e8f0' }}
                value={l.qty}
                onChange={(e) => {
                  const next = [...lines]
                  next[idx] = { ...l, qty: e.target.value }
                  setLines(next)
                }}
              />
              <input
                type="number"
                step="0.01"
                placeholder="Unit price"
                style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0d0d16', color: '#e2e8f0' }}
                value={l.unitPrice}
                onChange={(e) => {
                  const next = [...lines]
                  next[idx] = { ...l, unitPrice: e.target.value }
                  setLines(next)
                }}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          style={{ marginTop: 12, fontSize: 13, padding: '6px 12px', borderRadius: 8, border: '1px dashed #475569', background: 'transparent', color: '#93c5fd', cursor: 'pointer' }}
          onClick={() =>
            setLines([...lines, { lineNo: lines.length + 1, skuCode: '', description: '', qty: '1', unitPrice: '0' }])
          }
        >
          + Line
        </button>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        style={{
          marginTop: 28,
          padding: '12px 22px',
          borderRadius: 10,
          border: '1px solid #334155',
          background: '#1e293b',
          color: '#e2e8f0',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'Creating…' : 'Create draft quote'}
      </button>
    </main>
  )
}
