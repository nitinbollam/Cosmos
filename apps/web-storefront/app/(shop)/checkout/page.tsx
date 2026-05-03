'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'
import { getB2bCustomerId } from '@/lib/session'
import { useCartStore } from '@/stores/cart.store'

type CustomerRow = { id: string; name: string; email?: string | null; phone?: string | null }

type PaymentMethod = 'NET_TERMS' | 'CARD' | 'CASH' | 'CHECK' | 'ACH'

export default function CheckoutPage() {
  const router = useRouter()
  const items = useCartStore((s) => s.items)
  const cartSubtotal = useCartStore((s) => s.subtotal())
  const clear = useCartStore((s) => s.clear)
  const idempotencyKey = useRef(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  )

  const [step, setStep] = useState(1)
  const [customer, setCustomer] = useState<CustomerRow | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [company, setCompany] = useState('')
  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')

  const [payment, setPayment] = useState<PaymentMethod>('NET_TERMS')

  const loadCustomer = useCallback(async () => {
    const cid = getB2bCustomerId()
    if (!cid) {
      router.replace('/login')
      return
    }
    try {
      const c = await api.get<CustomerRow>(`/customers/${encodeURIComponent(cid)}`)
      setCustomer(c)
      setCompany(c.name)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    }
  }, [router])

  useEffect(() => {
    void loadCustomer()
  }, [loadCustomer])

  if (items.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <p style={{ color: 'var(--c-text-3)' }}>Your cart is empty.</p>
        <Link href="/catalog" className="btn-primary" style={{ display: 'inline-block', marginTop: 16 }}>
          Catalog
        </Link>
      </div>
    )
  }

  async function placeOrder() {
    const cid = getB2bCustomerId()
    if (!cid) {
      router.push('/login')
      return
    }
    setSubmitting(true)
    setErr(null)
    try {
      const order = await api.post<{ id: string }>(
        '/orders',
        {
          customerId: cid,
          channel: 'B2B_PORTAL',
          paymentMethod: payment,
          lineItems: items.map((i) => ({
            skuId: i.skuId,
            warehouseId: i.warehouseId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
          notes: `Ship to: ${company}, ${line1}${line2 ? `, ${line2}` : ''}, ${city}, ${state} ${zip}`,
        },
        { 'Idempotency-Key': idempotencyKey.current },
      )
      clear()
      router.push(`/orders/${encodeURIComponent(order.id)}/confirmation`)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--c-white)' }}>Checkout</h1>
      <div style={{ display: 'flex', gap: 12, marginTop: 20, marginBottom: 32 }}>
        {[1, 2, 3].map((s) => (
          <div key={s} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: step >= s ? 'var(--c-primary)' : 'var(--c-surface-2)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {s}
            </div>
            {s < 3 ? <div style={{ flex: 1, height: 2, background: 'var(--c-border)' }} /> : null}
          </div>
        ))}
      </div>
      {err ? <p style={{ color: 'var(--c-danger)', marginBottom: 16 }}>{err}</p> : null}

      {step === 1 ? (
        <div className="cosmos-card">
          <h2 style={{ marginTop: 0 }}>Shipping</h2>
          <p style={{ color: 'var(--c-text-3)', fontSize: 14 }}>Customer: {customer?.name ?? '…'}</p>
          <label style={{ fontSize: 12, color: 'var(--c-text-3)', display: 'block', marginTop: 12 }}>Company</label>
          <input className="cosmos-input" style={{ marginTop: 8 }} value={company} onChange={(e) => setCompany(e.target.value)} />
          <label style={{ fontSize: 12, color: 'var(--c-text-3)', display: 'block' }}>Address line 1</label>
          <input className="cosmos-input" style={{ marginTop: 8 }} value={line1} onChange={(e) => setLine1(e.target.value)} required />
          <label style={{ fontSize: 12, color: 'var(--c-text-3)', display: 'block', marginTop: 12 }}>Address line 2</label>
          <input className="cosmos-input" style={{ marginTop: 8 }} value={line2} onChange={(e) => setLine2(e.target.value)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-3)' }}>City</label>
              <input className="cosmos-input" style={{ marginTop: 8 }} value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-3)' }}>State</label>
              <input className="cosmos-input" style={{ marginTop: 8 }} value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-3)' }}>ZIP</label>
              <input className="cosmos-input" style={{ marginTop: 8 }} value={zip} onChange={(e) => setZip(e.target.value)} />
            </div>
          </div>
          <button type="button" className="btn-primary" style={{ marginTop: 24 }} onClick={() => setStep(2)} disabled={!line1.trim()}>
            Continue
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="cosmos-card">
          <h2 style={{ marginTop: 0 }}>Payment</h2>
          <select className="cosmos-input" value={payment} onChange={(e) => setPayment(e.target.value as PaymentMethod)}>
            <option value="NET_TERMS">Net terms</option>
            <option value="CASH">Cash</option>
            <option value="CHECK">Check</option>
            <option value="ACH">ACH</option>
            <option value="CARD">Card (billed via payment-service when configured)</option>
          </select>
          <p style={{ fontSize: 13, color: 'var(--c-text-3)', marginTop: 12 }}>
            Total due: <strong style={{ fontFamily: 'var(--font-mono)' }}>${cartSubtotal.toFixed(2)}</strong>
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button type="button" className="btn-primary" onClick={() => setStep(3)}>
              Review
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="cosmos-card">
          <h2 style={{ marginTop: 0 }}>Review</h2>
          <ul style={{ paddingLeft: 18, color: 'var(--c-text-2)' }}>
            {items.map((i) => (
              <li key={i.skuId}>
                {i.skuName} × {i.quantity} @ ${i.unitPrice.toFixed(2)}
              </li>
            ))}
          </ul>
          <p style={{ marginTop: 12 }}>
            Ship to: {company}, {line1}, {city} {state} {zip}
          </p>
          <p>
            Pay with: <strong>{payment.replace(/_/g, ' ')}</strong>
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18 }}>${cartSubtotal.toFixed(2)}</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button type="button" className="btn-ghost" onClick={() => setStep(2)}>
              Back
            </button>
            <button type="button" className="btn-primary" disabled={submitting} onClick={() => void placeOrder()}>
              {submitting ? 'Placing…' : 'Place order'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
