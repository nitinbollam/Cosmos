import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'
import { getB2bCustomerId } from '@/lib/session'
import { useCartStore } from '@/stores/cart.store'
import { StorefrontCardCapture } from '@/components/checkout-card-capture'

type CustomerRow = { id: string; name: string; email?: string | null; phone?: string | null }

type PaymentMethod = 'NET_TERMS' | 'CARD' | 'CASH' | 'CHECK' | 'ACH'

const stripePublishable = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? ''

export default function CheckoutPage() {
  const navigate = useNavigate()
  const items = useCartStore((s) => s.items)
  const cartSubtotal = useCartStore((s) => s.subtotal())
  const clear = useCartStore((s) => s.clear)
  const idempotencyKey = useRef(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  )

  const stripePromise = useMemo(() => (stripePublishable ? loadStripe(stripePublishable) : null), [])

  const taxAmount = useMemo(() => +(cartSubtotal * 0.07).toFixed(2), [cartSubtotal])
  const orderTotal = cartSubtotal + taxAmount

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
  const [cardPaymentMethodId, setCardPaymentMethodId] = useState<string | null>(null)

  const loadCustomer = useCallback(async () => {
    const cid = getB2bCustomerId()
    if (!cid) {
      navigate('/login')
      return
    }
    try {
      const c = await api.get<CustomerRow>(`/customers/${encodeURIComponent(cid)}`)
      setCustomer(c)
      setCompany(c.name)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    }
  }, [navigate])

  useEffect(() => {
    void loadCustomer()
  }, [loadCustomer])

  useEffect(() => {
    setCardPaymentMethodId(null)
  }, [payment])

  async function placeOrder() {
    const cid = getB2bCustomerId()
    if (!cid) {
      navigate('/login')
      return
    }
    if (payment === 'CARD') {
      if (!stripePublishable) {
        setErr('Set VITE_STRIPE_PUBLISHABLE_KEY for card checkout.')
        return
      }
      if (!cardPaymentMethodId) {
        setErr('Save your card on step 2 before placing the order.')
        return
      }
    }
    setSubmitting(true)
    setErr(null)
    try {
      const order = await api.post<{ id: string; totalAmount: string | number }>(
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

      if (payment === 'CARD' && cardPaymentMethodId) {
        const authKey =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2)
        await api.post(
          '/payments/authorize',
          {
            orderId: order.id,
            amount: Number(order.totalAmount),
            currency: 'usd',
            paymentMethod: 'CARD',
            customerId: cid,
            paymentMethodId: cardPaymentMethodId,
            correlationId: authKey,
          },
          { 'Idempotency-Key': authKey },
        )
      }

      clear()
      navigate(`/orders/${encodeURIComponent(order.id)}/confirmation`)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <p style={{ color: 'var(--c-text-3)' }}>Your cart is empty.</p>
        <Link to="/catalog" className="btn-primary" style={{ display: 'inline-block', marginTop: 16 }}>
          Catalog
        </Link>
      </div>
    )
  }

  const showStripe = payment === 'CARD' && !!stripePromise

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
        <PaymentStep2
          payment={payment}
          setPayment={setPayment}
          cartSubtotal={cartSubtotal}
          taxAmount={taxAmount}
          orderTotal={orderTotal}
          showStripe={showStripe}
          stripeConfigured={!!stripePublishable}
          stripePromise={stripePromise}
          cardPaymentMethodId={cardPaymentMethodId}
          setCardPaymentMethodId={setCardPaymentMethodId}
          onBack={() => setStep(1)}
          onReview={() => setStep(3)}
        />
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
            {payment === 'CARD' && cardPaymentMethodId ? (
              <span style={{ color: 'var(--c-success)', fontSize: 13 }}> — card on file</span>
            ) : null}
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18 }}>${orderTotal.toFixed(2)}</p>
          <p style={{ fontSize: 13, color: 'var(--c-text-3)' }}>
            Subtotal ${cartSubtotal.toFixed(2)} · Tax ${taxAmount.toFixed(2)}
          </p>
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

function PaymentStep2({
  payment,
  setPayment,
  cartSubtotal,
  taxAmount,
  orderTotal,
  showStripe,
  stripeConfigured,
  stripePromise,
  cardPaymentMethodId,
  setCardPaymentMethodId,
  onBack,
  onReview,
}: {
  payment: PaymentMethod
  setPayment: (p: PaymentMethod) => void
  cartSubtotal: number
  taxAmount: number
  orderTotal: number
  showStripe: boolean
  stripeConfigured: boolean
  stripePromise: Promise<Stripe | null> | null
  cardPaymentMethodId: string | null
  setCardPaymentMethodId: (id: string | null) => void
  onBack: () => void
  onReview: () => void
}) {
  const inner = (
    <>
      <h2 style={{ marginTop: 0 }}>Payment</h2>
      <select className="cosmos-input" value={payment} onChange={(e) => setPayment(e.target.value as PaymentMethod)}>
        <option value="NET_TERMS">Net terms</option>
        <option value="CASH">Cash</option>
        <option value="CHECK">Check</option>
        <option value="ACH">ACH</option>
        <option value="CARD">Credit card (Stripe)</option>
      </select>
      {payment === 'NET_TERMS' ? (
        <p style={{ fontSize: 13, color: 'var(--c-success)', marginTop: 12 }}>
          ✓ Invoiced on terms — place order to confirm.
        </p>
      ) : null}
      {showStripe ? (
        <>
          {!stripeConfigured ? (
            <p style={{ color: 'var(--c-danger)', marginTop: 12 }}>Missing VITE_STRIPE_PUBLISHABLE_KEY.</p>
          ) : (
            <StorefrontCardCapture onPaymentMethodId={(id) => setCardPaymentMethodId(id)} />
          )}
          {cardPaymentMethodId ? (
            <p style={{ fontSize: 13, color: 'var(--c-success)', marginTop: 8 }}>Card saved for this checkout.</p>
          ) : null}
        </>
      ) : null}
      <p style={{ fontSize: 13, color: 'var(--c-text-3)', marginTop: 12 }}>
        Subtotal ${cartSubtotal.toFixed(2)} · Tax ${taxAmount.toFixed(2)} · Total due{' '}
        <strong style={{ fontFamily: 'var(--font-mono)' }}>${orderTotal.toFixed(2)}</strong>
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button type="button" className="btn-ghost" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={onReview}
          disabled={payment === 'CARD' && stripeConfigured && !cardPaymentMethodId}
        >
          Review
        </button>
      </div>
    </>
  )

  if (showStripe && stripePromise) {
    return (
      <div className="cosmos-card">
        <Elements stripe={stripePromise} options={{ appearance: { theme: 'night' } }}>
          {inner}
        </Elements>
      </div>
    )
  }

  return <div className="cosmos-card">{inner}</div>
}
