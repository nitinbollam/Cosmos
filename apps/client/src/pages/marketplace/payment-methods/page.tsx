import { Elements, CardElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { api } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'

type Pm = { id: string; stripePaymentMethodId: string; brand: string | null; last4: string | null; isDefault: boolean }

const cardStyle = {
  style: {
    base: { color: '#E2E8F0', fontSize: '14px', '::placeholder': { color: '#64748B' } },
    invalid: { color: '#EF4444' },
  },
}

function AddCardForm({ onSaved }: { onSaved: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!stripe || !elements) return
    setBusy(true)
    setErr(null)
    try {
      const card = elements.getElement(CardElement)
      if (!card) throw new Error('Card field missing')
      const { error, paymentMethod } = await stripe.createPaymentMethod({ type: 'card', card })
      if (error || !paymentMethod) throw new Error(error?.message ?? 'Could not create payment method')
      await api.post('/marketplace/payment-methods', {
        stripePaymentMethodId: paymentMethod.id,
        brand: paymentMethod.card?.brand,
        last4: paymentMethod.card?.last4,
        expMonth: paymentMethod.card?.exp_month,
        expYear: paymentMethod.card?.exp_year,
        isDefault: true,
      })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 max-w-md">
      <CardElement options={cardStyle} />
      <button type="button" className="btn-primary text-sm mt-3" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save card for bidding'}
      </button>
      {err && <p className="text-sm text-red-400 mt-2">{err}</p>}
    </div>
  )
}

export default function MarketplacePaymentMethodsPage() {
  const qc = useQueryClient()
  const pk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined
  const stripePromise = useMemo(() => (pk ? loadStripe(pk) : null), [pk])

  const pmQ = useQuery({
    queryKey: ['marketplace', 'payment-methods'],
    queryFn: () => api.get<Pm[]>('/marketplace/payment-methods'),
  })

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/marketplace/payment-methods/${encodeURIComponent(id)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['marketplace', 'payment-methods'] }),
  })

  return (
    <div>
      <Link to="/admin/marketplace" className="text-sm text-pleros-accent">
        ← Marketplace
      </Link>
      <h1 className="text-2xl font-display text-pleros-white mt-2">Payment methods</h1>
      <p className="text-sm text-pleros-text-3 mt-1">Required before placing auction bids. Used for auto-charge when you win.</p>

      <ul className="mt-4 space-y-2">
        {(pmQ.data ?? []).map((pm: Pm) => (
          <li key={pm.id} className="text-sm flex justify-between items-center">
            <span>
              {(pm.brand ?? 'Card').toUpperCase()} •••• {pm.last4} {pm.isDefault && '(default)'}
            </span>
            <button type="button" className="text-red-400 text-xs" onClick={() => void delMut.mutate(pm.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {delMut.error && <p className="text-sm text-red-400 mt-2">{axiosErr(delMut.error)}</p>}

      {stripePromise ? (
        <Elements stripe={stripePromise}>
          <AddCardForm onSaved={() => void qc.invalidateQueries({ queryKey: ['marketplace', 'payment-methods'] })} />
        </Elements>
      ) : (
        <p className="text-sm text-amber-400 mt-4">Stripe is not configured in this environment.</p>
      )}
    </div>
  )
}
