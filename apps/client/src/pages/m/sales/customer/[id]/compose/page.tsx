import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-mobile'
import { axiosErr } from '@/lib/axios-error'
import {
  addToCart,
  cartPayload,
  cartTotal,
  creditLabel,
  money,
  overLimitBy,
  setQuantity,
  type CartLine,
  type CatalogItem,
  type CreditView,
} from '@/lib/rep-app'

/** One screen for both a quote and an order: pick items at the customer's price, then send. */
export default function RepBuildPage() {
  const { id } = useParams<{ id: string }>()
  const mode = useSearchParams()[0].get('mode') === 'quote' ? 'quote' : 'order'
  const navigate = useNavigate()
  const base = `/rep/accounts/${encodeURIComponent(id ?? '')}`
  const [q, setQ] = useState('')
  const [items, setItems] = useState<CatalogItem[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [credit, setCredit] = useState<CreditView | null>(null)
  const [payment, setPayment] = useState('NET_TERMS')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api.get<{ credit: CreditView }>(base).then((d) => setCredit(d.credit)).catch((e) => setErr(axiosErr(e)))
  }, [id, base])

  useEffect(() => {
    if (!id) return
    const t = setTimeout(() => {
      api.get<CatalogItem[]>(`${base}/catalog?q=${encodeURIComponent(q)}`).then(setItems).catch((e) => setErr(axiosErr(e)))
    }, 250)
    return () => clearTimeout(t)
  }, [id, base, q])

  const total = cartTotal(cart)
  const over = credit && mode === 'order' && payment === 'NET_TERMS' ? overLimitBy(credit, total) : 0

  async function send() {
    if (cart.length === 0) return setErr('Add at least one item')
    setBusy(true)
    setErr(null)
    try {
      const body = { lines: cartPayload(cart), notes: notes.trim() || undefined }
      if (mode === 'quote') {
        await api.post(`${base}/quote`, body)
        setSent('Quote saved.')
      } else {
        const res = await api.post<{ awaitingApproval: boolean }>(`${base}/orders`, { ...body, paymentMethod: payment })
        setSent(res.awaitingApproval ? 'Order placed. It is over the credit limit, so a manager has to approve it first.' : 'Order placed.')
      }
      setCart([])
    } catch (e) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="pleros-mobile-card">
        <p>{sent}</p>
        <button type="button" className="btn-primary" onClick={() => navigate(`/m/sales/customer/${id}`)}>Back to account</button>
      </div>
    )
  }

  return (
    <div>
      <Link to={`/m/sales/customer/${id}`} className="pleros-shop-link-accent" style={{ fontSize: 13 }}>← Account</Link>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>{mode === 'quote' ? 'New quote' : 'New order'}</h1>
      {credit && mode === 'order' && <p style={{ fontSize: 13, opacity: 0.8 }}>{creditLabel(credit)}</p>}
      {err && <p style={{ color: 'var(--c-danger)', fontSize: 13 }}>{err}</p>}

      <input className="pleros-input" placeholder="Search by name, code or barcode" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      {items.map((it) => (
        <button key={it.id} type="button" className="pleros-mobile-card" style={{ display: 'block', width: '100%', textAlign: 'left', color: 'inherit' }} onClick={() => setCart((c) => addToCart(c, it))}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{it.name}</strong><span>{money(it.unitPrice)}</span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.7 }}>
            {it.code}{it.source === 'contract' ? ` · their price (list ${money(it.listPrice)})` : ''}
          </p>
        </button>
      ))}

      {cart.length > 0 && (
        <>
          <h2 style={{ fontSize: '1rem', marginTop: 16 }}>{mode === 'quote' ? 'Quote' : 'Order'}</h2>
          {cart.map((l) => (
            <div key={l.skuId} className="pleros-mobile-card" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <strong style={{ fontSize: 14 }}>{l.name}</strong>
                <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.7 }}>{money(l.unitPrice)} each</p>
              </div>
              <input className="pleros-input" type="number" inputMode="numeric" min={0} value={l.quantity} style={{ width: 70 }}
                onChange={(e) => setCart((c) => setQuantity(c, l.skuId, e.target.value))} />
            </div>
          ))}
          {mode === 'order' && (
            <select className="pleros-input" value={payment} onChange={(e) => setPayment(e.target.value)} style={{ width: '100%', marginTop: 8 }}>
              <option value="NET_TERMS">On terms</option>
              <option value="CASH">Cash</option>
              <option value="CHECK">Check</option>
            </select>
          )}
          <input className="pleros-input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%', marginTop: 8 }} />
          <p style={{ fontSize: 13, opacity: 0.75 }}>Before tax. The final total is worked out when it is sent.</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: '4px 0' }}>{money(total)}</p>
          {over > 0 && <p style={{ color: 'var(--c-warning)', fontSize: 13 }}>This is {money(over)} over the credit limit. A manager will have to approve it.</p>}
          <button type="button" className="btn-primary" style={{ width: '100%', padding: 14 }} disabled={busy} onClick={() => void send()}>
            {busy ? 'Sending…' : mode === 'quote' ? 'Save quote' : 'Place order'}
          </button>
        </>
      )}
    </div>
  )
}
