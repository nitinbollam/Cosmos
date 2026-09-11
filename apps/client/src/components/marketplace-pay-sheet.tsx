import { Elements, CardElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'

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

function PayForm({
  orderId,
  onPaid,
}: {
  orderId: string
  onPaid: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function pay() {
    if (!stripe || !elements) {
      setErr('Stripe not ready')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const intent = await api.post<{ clientSecret: string; stripePaymentIntentId: string }>(
        `/marketplace/orders/${encodeURIComponent(orderId)}/payment-intent`,
        {},
      )
      const card = elements.getElement(CardElement)
      if (!card) throw new Error('Card field missing')

      const { error, paymentIntent } = await stripe.confirmCardPayment(intent.clientSecret, {
        payment_method: { card },
      })
      if (error) {
        setErr(error.message ?? 'Payment failed')
        return
      }
      const piId = paymentIntent?.id ?? intent.stripePaymentIntentId
      await api.post(`/marketplace/orders/${encodeURIComponent(orderId)}/pay`, {
        stripePaymentIntentId: piId,
      })
      onPaid()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Payment failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2">
      <div
        className="rounded-lg border p-3"
        style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
      >
        <CardElement options={cardStyle} />
      </div>
      {err && <p className="text-sm text-red-400 mt-2">{err}</p>}
      <button type="button" className="btn-primary text-sm mt-3" disabled={busy || !stripe} onClick={() => void pay()}>
        {busy ? 'Processing…' : 'Pay with card'}
      </button>
    </div>
  )
}

/** Marketplace charges run on the platform account (escrow), not the tenant Connect account. */
function usePlatformStripe() {
  const configQ = useQuery({
    queryKey: ['marketplace', 'platform-stripe'],
    queryFn: () => api.get<{ publishableKey: string }>('/payments/stripe/config'),
    staleTime: 60_000,
  })
  return useMemo(() => {
    const pk = configQ.data?.publishableKey || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ''
    return pk ? loadStripe(pk) : null
  }, [configQ.data?.publishableKey])
}

export function MarketplacePaySheet({
  orderId,
  onPaid,
}: {
  orderId: string
  onPaid: () => void
}) {
  const stripePromise = usePlatformStripe()

  if (!stripePromise) {
    return <p className="text-sm text-pleros-text-3">Stripe is not configured for payments.</p>
  }

  return (
    <Elements stripe={stripePromise} options={{ appearance: { theme: 'night' } }}>
      <PayForm orderId={orderId} onPaid={onPaid} />
    </Elements>
  )
}
