import { CardElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { useCallback, useState } from 'react'
import { submitCard } from '@/lib/card-submit'

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

export type StripeCardSubmitResult = {
  paymentMethodId: string
}

type Props = {
  onSubmit: (result: StripeCardSubmitResult) => void | Promise<void>
  submitLabel?: string
  disabled?: boolean
  /** Checked before the card is sent to Stripe; a returned message is shown and nothing is sent. */
  validate?: () => string | null
}

export function AdminStripeCardForm({ onSubmit, submitLabel = 'Save card', disabled, validate }: Props) {
  const stripe = useStripe()
  const elements = useElements()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = useCallback(async () => {
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
    try {
      await submitCard({
        validate,
        createPaymentMethod: () => stripe.createPaymentMethod({ type: 'card', card }),
        onSubmit,
        setErr,
      })
    } finally {
      setBusy(false)
    }
  }, [stripe, elements, onSubmit, validate])

  return (
    <div>
      <div
        className="rounded-lg border p-3"
        style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
      >
        <CardElement options={cardStyle} />
      </div>
      {err ? <p className="text-sm mt-2 text-red-400">{err}</p> : null}
      <button
        type="button"
        className="btn-primary mt-3"
        disabled={busy || disabled || !stripe}
        onClick={() => void handleSubmit()}
      >
        {busy ? 'Processing…' : submitLabel}
      </button>
    </div>
  )
}

export async function confirmStripeAction(
  stripe: ReturnType<typeof useStripe>,
  clientSecret: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!stripe) return { ok: false, error: 'Stripe not ready' }
  const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret)
  if (error) return { ok: false, error: error.message }
  if (paymentIntent?.status === 'requires_capture' || paymentIntent?.status === 'succeeded') {
    return { ok: true }
  }
  return { ok: false, error: `Unexpected status: ${paymentIntent?.status ?? 'unknown'}` }
}
