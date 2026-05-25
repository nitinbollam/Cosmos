'use client'

import { CardElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { useCallback, useState } from 'react'

const cardStyle = {
  style: {
    base: {
      color: '#E2E8F0',
      fontSize: '14px',
      fontFamily: 'DM Sans, system-ui, sans-serif',
      '::placeholder': { color: '#64748B' },
      iconColor: '#94A3B8',
    },
    invalid: { color: '#EF4444' },
  },
}

export function StorefrontCardCapture({
  onPaymentMethodId,
}: {
  onPaymentMethodId: (id: string) => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const saveCard = useCallback(async () => {
    if (!stripe || !elements) {
      setErr('Stripe not ready')
      return
    }
    const card = elements.getElement(CardElement)
    if (!card) {
      setErr('Card field missing')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const { error, paymentMethod } = await stripe.createPaymentMethod({ type: 'card', card })
      if (error) {
        setErr(error.message ?? 'Card error')
        return
      }
      if (paymentMethod) onPaymentMethodId(paymentMethod.id)
    } finally {
      setBusy(false)
    }
  }, [stripe, elements, onPaymentMethodId])

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          padding: 12,
          borderRadius: 10,
          border: '1px solid var(--c-border)',
          background: 'var(--c-surface-2)',
        }}
      >
        <CardElement options={cardStyle} />
      </div>
      {err ? <p style={{ color: 'var(--c-danger)', fontSize: 13, marginTop: 8 }}>{err}</p> : null}
      <button
        type="button"
        className="btn-ghost"
        style={{ marginTop: 12 }}
        disabled={busy || !stripe}
        onClick={() => void saveCard()}
      >
        {busy ? 'Saving…' : 'Save card for checkout'}
      </button>
    </div>
  )
}
