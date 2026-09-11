import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'
import { getB2bCustomerId } from '@/lib/session'
import { useStripeConnect } from '@/lib/stripe-connect'
import type { Stripe } from '@stripe/stripe-js'
import { useCartStore } from '@/stores/cart.store'
import { StorefrontCardCapture } from '@/components/checkout-card-capture'

type CustomerRow = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  isLicensedTobacco?: boolean | null
  tobaccoLicenseNumber?: string | null
}

type SavedCard = {
  id: string
  brand?: string | null
  last4?: string | null
  expMonth?: number | null
  expYear?: number | null
  isDefault: boolean
  stripePaymentMethodId: string
}

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

  const { stripePromise, chargesEnabled, loading: stripeConfigLoading } = useStripeConnect(api.get.bind(api), 'checkout-stripe')

  const [taxRate, setTaxRate] = useState(0.07)
  const [discountCode, setDiscountCode] = useState('')
  const [discountAmount, setDiscountAmount] = useState(0)
  const [discountPending, setDiscountPending] = useState(false)
  const [discountMsg, setDiscountMsg] = useState<string | null>(null)
  const [validatingDiscount, setValidatingDiscount] = useState(false)

  const [giftCardCode, setGiftCardCode] = useState('')
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null)
  const [giftCardMsg, setGiftCardMsg] = useState<string | null>(null)
  const [checkingGiftCard, setCheckingGiftCard] = useState(false)

  const discountedSubtotal = Math.max(0, cartSubtotal - discountAmount)
  const taxAmount = useMemo(() => +(discountedSubtotal * taxRate).toFixed(2), [discountedSubtotal, taxRate])
  const orderTotal = discountedSubtotal + taxAmount
  const giftCardApplied =
    giftCardBalance != null && giftCardBalance > 0 ? Math.min(giftCardBalance, orderTotal) : 0
  const amountDue = +(orderTotal - giftCardApplied).toFixed(2)

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
  const [savedCards, setSavedCards] = useState<SavedCard[]>([])
  const [cardMode, setCardMode] = useState<'saved' | 'new'>('saved')
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null)
  const [saveNewCardToAccount, setSaveNewCardToAccount] = useState(true)

  const loadCustomer = useCallback(async () => {
    if (!getB2bCustomerId()) {
      navigate('/login')
      return
    }
    try {
      const [c, tax, methods] = await Promise.all([
        api.get<CustomerRow & {
          primaryAddressLine1?: string | null
          primaryCity?: string | null
          primaryState?: string | null
          primaryZip?: string | null
        }>('/customers/me'),
        api.get<{ salesTaxRate: number }>('/tax/settings'),
        api.get<SavedCard[]>('/saved-payment-methods').catch(() => [] as SavedCard[]),
      ])
      setCustomer(c)
      setCompany(c.name)
      setLine1(c.primaryAddressLine1 ?? '')
      setCity(c.primaryCity ?? '')
      setState(c.primaryState ?? '')
      setZip(c.primaryZip ?? '')
      setTaxRate(tax.salesTaxRate)
      setSavedCards(methods)
      const defaultCard = methods.find((m) => m.isDefault) ?? methods[0]
      if (defaultCard) {
        setSelectedSavedId(defaultCard.id)
        setCardPaymentMethodId(defaultCard.stripePaymentMethodId)
        setCardMode('saved')
      } else {
        setCardMode('new')
      }
    } catch (e: unknown) {
      setErr(axiosErr(e))
    }
  }, [navigate])

  useEffect(() => {
    void loadCustomer()
  }, [loadCustomer])

  useEffect(() => {
    setCardPaymentMethodId(null)
    if (payment !== 'CARD') return
    if (cardMode === 'saved' && selectedSavedId) {
      const card = savedCards.find((c) => c.id === selectedSavedId)
      setCardPaymentMethodId(card?.stripePaymentMethodId ?? null)
    }
  }, [payment, cardMode, selectedSavedId, savedCards])

  async function checkGiftCard() {
    const code = giftCardCode.trim()
    if (!code) return
    setCheckingGiftCard(true)
    setGiftCardMsg(null)
    setGiftCardBalance(null)
    try {
      const res = await api.get<{ valid: boolean; balance?: number; expired?: boolean }>(
        `/gift-cards/${encodeURIComponent(code)}/balance`,
      )
      if (!res.valid) {
        setGiftCardMsg(res.expired ? 'Gift card expired' : 'Invalid gift card code')
        return
      }
      setGiftCardBalance(res.balance ?? 0)
      setGiftCardMsg(`Balance: $${(res.balance ?? 0).toFixed(2)}`)
    } catch (e: unknown) {
      setGiftCardMsg(axiosErr(e))
    } finally {
      setCheckingGiftCard(false)
    }
  }

  async function validateDiscountCode() {
    const cid = getB2bCustomerId()
    if (!cid || !discountCode.trim()) return
    setValidatingDiscount(true)
    setDiscountMsg(null)
    setDiscountPending(false)
    setDiscountAmount(0)
    try {
      const res = await api.post<{
        valid: boolean
        reason?: string
        amountOff?: number
        pendingApproval?: boolean
      }>('/discounts/validate', {
        code: discountCode.trim(),
        orderSubtotal: cartSubtotal,
        customerId: cid,
      })
      if (!res.valid) {
        setDiscountMsg(res.reason ?? 'Invalid discount')
        return
      }
      if (res.pendingApproval) {
        setDiscountPending(true)
        setDiscountMsg('Discount pending manager approval — checkout at full price or wait for approval.')
        return
      }
      setDiscountAmount(res.amountOff ?? 0)
      setDiscountMsg(`Discount applied: −$${(res.amountOff ?? 0).toFixed(2)}`)
    } catch (e: unknown) {
      setDiscountMsg(axiosErr(e))
    } finally {
      setValidatingDiscount(false)
    }
  }

  async function placeOrder() {
    const cid = getB2bCustomerId()
    if (!cid) {
      navigate('/login')
      return
    }
    if (payment === 'CARD' && amountDue > 0) {
      if (!stripePublishable) {
        setErr('Set VITE_STRIPE_PUBLISHABLE_KEY for card checkout.')
        return
      }
      if (!chargesEnabled) {
        setErr('Card checkout is unavailable until your distributor completes Stripe Connect onboarding.')
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
          ...(discountAmount > 0 && !discountPending ? { discountCode: discountCode.trim() } : {}),
          shippingAddress: {
            company,
            line1,
            line2: line2 || undefined,
            city,
            state,
            postalCode: zip,
          },
        },
        { 'Idempotency-Key': idempotencyKey.current },
      )

      if (giftCardApplied > 0 && giftCardCode.trim()) {
        await api.post(`/gift-cards/${encodeURIComponent(giftCardCode.trim())}/redeem`, {
          amount: giftCardApplied,
          orderRef: order.id,
        })
      }

      if (payment === 'CARD' && cardPaymentMethodId && amountDue > 0) {
        const authKey =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2)
        const authRes = await api.post<{
          requiresAction?: boolean
          clientSecret?: string
          paymentIntentId?: string
          status?: string
        }>(
          '/payments/authorize',
          {
            orderId: order.id,
            amount: amountDue,
            currency: 'usd',
            paymentMethod: 'CARD',
            customerId: cid,
            paymentMethodId: cardPaymentMethodId,
            correlationId: authKey,
          },
          { 'Idempotency-Key': authKey },
        )

        if (authRes.requiresAction && authRes.clientSecret && stripePromise) {
          const stripe = await stripePromise
          if (!stripe) throw new Error('Stripe not ready')
          const { error } = await stripe.confirmCardPayment(authRes.clientSecret)
          if (error) throw error
          const confirmKey =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : Math.random().toString(36).slice(2)
          await api.post(
            '/payments/confirm',
            { paymentIntentId: authRes.paymentIntentId, correlationId: confirmKey },
            { 'Idempotency-Key': confirmKey },
          )
        }

        if (cardMode === 'new' && saveNewCardToAccount && cardPaymentMethodId.startsWith('pm_')) {
          await api
            .post('/saved-payment-methods', {
              stripePaymentMethodId: cardPaymentMethodId,
              isDefault: savedCards.length === 0,
            })
            .catch(() => undefined)
        }
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
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--c-heading)' }}>Checkout</h1>
      <div style={{ display: 'flex', gap: 12, marginTop: 20, marginBottom: 32 }}>
        {[1, 2, 3].map((s) => (
          <div key={s} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: step >= s ? 'var(--c-primary)' : 'var(--c-surface-2)',
                color: step >= s ? 'var(--c-on-primary)' : 'var(--c-text-2)',
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
        <div className="pleros-card">
          <h2 style={{ marginTop: 0 }}>Shipping</h2>
          <p style={{ color: 'var(--c-text-3)', fontSize: 14 }}>Customer: {customer?.name ?? '…'}</p>
          <label style={{ fontSize: 12, color: 'var(--c-text-3)', display: 'block', marginTop: 12 }}>Company</label>
          <input className="pleros-input" style={{ marginTop: 8 }} value={company} onChange={(e) => setCompany(e.target.value)} />
          <label style={{ fontSize: 12, color: 'var(--c-text-3)', display: 'block' }}>Address line 1</label>
          <input className="pleros-input" style={{ marginTop: 8 }} value={line1} onChange={(e) => setLine1(e.target.value)} required />
          <label style={{ fontSize: 12, color: 'var(--c-text-3)', display: 'block', marginTop: 12 }}>Address line 2</label>
          <input className="pleros-input" style={{ marginTop: 8 }} value={line2} onChange={(e) => setLine2(e.target.value)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-3)' }}>City</label>
              <input className="pleros-input" style={{ marginTop: 8 }} value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-3)' }}>State</label>
              <input className="pleros-input" style={{ marginTop: 8 }} value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--c-text-3)' }}>ZIP</label>
              <input className="pleros-input" style={{ marginTop: 8 }} value={zip} onChange={(e) => setZip(e.target.value)} />
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
          stripeConfigured={!!stripePublishable && chargesEnabled}
          stripeConnectPending={!stripeConfigLoading && !!stripePublishable && !chargesEnabled}
          stripePromise={stripePromise}
          cardPaymentMethodId={cardPaymentMethodId}
          setCardPaymentMethodId={setCardPaymentMethodId}
          savedCards={savedCards}
          cardMode={cardMode}
          setCardMode={setCardMode}
          selectedSavedId={selectedSavedId}
          setSelectedSavedId={setSelectedSavedId}
          saveNewCardToAccount={saveNewCardToAccount}
          setSaveNewCardToAccount={setSaveNewCardToAccount}
          onBack={() => setStep(1)}
          onReview={() => setStep(3)}
        />
      ) : null}

      {step === 3 ? (
        <div className="pleros-card">
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
          {customer && !customer.isLicensedTobacco ? (
            <p
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 8,
                background: 'var(--c-surface-2)',
                border: '1px solid var(--c-border)',
                color: 'var(--c-text-2)',
                fontSize: 13,
              }}
            >
              Your account is not marked as licensed for regulated / age-restricted products. Orders that include those
              SKUs will be blocked until your distributor adds a license on your customer record.
            </p>
          ) : null}
          <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--c-surface-2)' }}>
            <label style={{ fontSize: 12, color: 'var(--c-text-3)' }}>Discount code</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                className="pleros-input"
                value={discountCode}
                onChange={(e) => {
                  setDiscountCode(e.target.value)
                  setDiscountAmount(0)
                  setDiscountPending(false)
                  setDiscountMsg(null)
                }}
                placeholder="Optional promo code"
              />
              <button
                type="button"
                className="btn-ghost"
                disabled={validatingDiscount || !discountCode.trim()}
                onClick={() => void validateDiscountCode()}
              >
                {validatingDiscount ? '…' : 'Apply'}
              </button>
            </div>
            {discountMsg ? (
              <p style={{ fontSize: 13, marginTop: 8, color: discountPending ? 'var(--c-warning)' : 'var(--c-text-2)' }}>
                {discountMsg}
              </p>
            ) : null}
          </div>
          <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--c-surface-2)' }}>
            <label style={{ fontSize: 12, color: 'var(--c-text-3)' }}>Gift card</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                className="pleros-input"
                value={giftCardCode}
                onChange={(e) => {
                  setGiftCardCode(e.target.value)
                  setGiftCardBalance(null)
                  setGiftCardMsg(null)
                }}
                placeholder="Optional gift card code"
              />
              <button
                type="button"
                className="btn-ghost"
                disabled={checkingGiftCard || !giftCardCode.trim()}
                onClick={() => void checkGiftCard()}
              >
                {checkingGiftCard ? '…' : 'Check'}
              </button>
            </div>
            {giftCardMsg ? (
              <p style={{ fontSize: 13, marginTop: 8, color: 'var(--c-text-2)' }}>{giftCardMsg}</p>
            ) : null}
            {giftCardApplied > 0 && giftCardApplied < orderTotal ? (
              <p style={{ fontSize: 13, marginTop: 8, color: 'var(--c-warning)' }}>
                Gift card covers ${giftCardApplied.toFixed(2)} — pay ${amountDue.toFixed(2)} with {payment.replace(/_/g, ' ').toLowerCase()}.
              </p>
            ) : null}
          </div>
          <p style={{ marginTop: 16 }}>
            Subtotal ${cartSubtotal.toFixed(2)}
            {discountAmount > 0 ? ` · Discount −$${discountAmount.toFixed(2)}` : ''}
            {giftCardApplied > 0 ? ` · Gift card −$${giftCardApplied.toFixed(2)}` : ''}
            {` · Tax $${taxAmount.toFixed(2)} · Total $${orderTotal.toFixed(2)}`}
            {giftCardApplied > 0 ? ` · Due now $${amountDue.toFixed(2)}` : ''}
          </p>
          <p>
            Pay with: <strong>{amountDue === 0 && giftCardApplied > 0 ? 'GIFT CARD' : payment.replace(/_/g, ' ')}</strong>
            {payment === 'CARD' && cardPaymentMethodId ? (
              <span style={{ color: 'var(--c-success)', fontSize: 13 }}>
                {' '}
                —{' '}
                {cardMode === 'saved'
                  ? `saved ${savedCards.find((c) => c.id === selectedSavedId)?.brand ?? 'card'} •••• ${savedCards.find((c) => c.id === selectedSavedId)?.last4 ?? '????'}`
                  : 'new card on file'}
              </span>
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
  stripeConnectPending,
  stripePromise,
  cardPaymentMethodId,
  setCardPaymentMethodId,
  savedCards,
  cardMode,
  setCardMode,
  selectedSavedId,
  setSelectedSavedId,
  saveNewCardToAccount,
  setSaveNewCardToAccount,
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
  stripeConnectPending: boolean
  stripePromise: Promise<Stripe | null> | null
  cardPaymentMethodId: string | null
  setCardPaymentMethodId: (id: string | null) => void
  savedCards: SavedCard[]
  cardMode: 'saved' | 'new'
  setCardMode: (m: 'saved' | 'new') => void
  selectedSavedId: string | null
  setSelectedSavedId: (id: string | null) => void
  saveNewCardToAccount: boolean
  setSaveNewCardToAccount: (v: boolean) => void
  onBack: () => void
  onReview: () => void
}) {
  const canReviewCard =
    payment !== 'CARD' ||
    !stripeConfigured ||
    (cardMode === 'saved' && !!cardPaymentMethodId) ||
    (cardMode === 'new' && !!cardPaymentMethodId)

  const inner = (
    <>
      <h2 style={{ marginTop: 0 }}>Payment</h2>
      <select className="pleros-input" value={payment} onChange={(e) => setPayment(e.target.value as PaymentMethod)}>
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
      {payment === 'CARD' && stripeConfigured ? (
        <div style={{ marginTop: 16 }}>
          {savedCards.length > 0 ? (
            <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: 'var(--c-text-3)', margin: 0 }}>Saved cards</p>
              {savedCards.map((c) => (
                <label
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1px solid ${cardMode === 'saved' && selectedSavedId === c.id ? 'var(--c-primary)' : 'var(--c-border)'}`,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="savedCard"
                    checked={cardMode === 'saved' && selectedSavedId === c.id}
                    onChange={() => {
                      setCardMode('saved')
                      setSelectedSavedId(c.id)
                      setCardPaymentMethodId(c.stripePaymentMethodId)
                    }}
                  />
                  <span>
                    {(c.brand ?? 'Card').toUpperCase()} •••• {c.last4 ?? '????'}
                    {c.isDefault ? <span style={{ marginLeft: 8, color: 'var(--c-accent)', fontSize: 12 }}>Default</span> : null}
                  </span>
                </label>
              ))}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: `1px solid ${cardMode === 'new' ? 'var(--c-primary)' : 'var(--c-border)'}`,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="savedCard"
                  checked={cardMode === 'new'}
                  onChange={() => {
                    setCardMode('new')
                    setCardPaymentMethodId(null)
                  }}
                />
                <span>Use a new card</span>
              </label>
            </div>
          ) : null}
          {(cardMode === 'new' || savedCards.length === 0) && showStripe ? (
            <>
              <StorefrontCardCapture onPaymentMethodId={(id) => setCardPaymentMethodId(id)} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={saveNewCardToAccount}
                  onChange={(e) => setSaveNewCardToAccount(e.target.checked)}
                />
                Save this card to my account for next time
              </label>
            </>
          ) : null}
          {cardPaymentMethodId ? (
            <p style={{ fontSize: 13, color: 'var(--c-success)', marginTop: 8 }}>Card ready for authorization.</p>
          ) : null}
        </div>
      ) : null}
      {payment === 'CARD' && stripeConnectPending ? (
        <p style={{ color: 'var(--c-danger)', marginTop: 12 }}>
          Card payments are not available yet — your distributor must finish Stripe Connect onboarding.
        </p>
      ) : null}
      {payment === 'CARD' && !stripeConfigured && !stripeConnectPending ? (
        <p style={{ color: 'var(--c-danger)', marginTop: 12 }}>Missing VITE_STRIPE_PUBLISHABLE_KEY.</p>
      ) : null}
      <p style={{ fontSize: 13, color: 'var(--c-text-3)', marginTop: 12 }}>
        Subtotal ${cartSubtotal.toFixed(2)} · Tax ${taxAmount.toFixed(2)} · Total due{' '}
        <strong style={{ fontFamily: 'var(--font-mono)' }}>${orderTotal.toFixed(2)}</strong>
      </p>
      <p style={{ fontSize: 12, marginTop: 8 }}>
        <Link to="/account" style={{ color: 'var(--c-accent)' }}>
          Manage saved cards on your account →
        </Link>
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button type="button" className="btn-ghost" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn-primary" onClick={onReview} disabled={!canReviewCard}>
          Review
        </button>
      </div>
    </>
  )

  if (showStripe && stripePromise && payment === 'CARD' && (cardMode === 'new' || savedCards.length === 0)) {
    return (
      <div className="pleros-card">
        <Elements stripe={stripePromise} options={{ appearance: { theme: 'night' } }}>
          {inner}
        </Elements>
      </div>
    )
  }

  return <div className="pleros-card">{inner}</div>
}
