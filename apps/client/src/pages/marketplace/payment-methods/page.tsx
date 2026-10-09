import { Elements, CardElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'
import { EmptyState } from '@/components/pleros/empty-state'
import { MarketplaceNav } from '../marketplace-nav'

type Pm = {
  id: string
  stripePaymentMethodId: string
  brand: string | null
  last4: string | null
  isDefault: boolean
}

const cardStyle = {
  style: {
    base: {
      color: '#E2E8F0',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '15px',
      '::placeholder': { color: '#64748B' },
      iconColor: '#94A3B8',
    },
    invalid: { color: '#EF4444', iconColor: '#EF4444' },
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
      card.clear()
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="p-4 rounded-xl border focus-within:ring-2 focus-within:ring-pleros-primary transition-all"
        style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
      >
        <CardElement options={cardStyle} />
      </div>

      <div
        className="p-3 rounded-lg border text-xs text-pleros-text-3 flex items-start gap-2"
        style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
      >
        <span className="text-base leading-none">🔒</span>
        <span>
          Card details are encrypted via Stripe 256-bit SSL. Pleros complies with PCI-DSS and does not store raw credit card numbers.
        </span>
      </div>

      {err && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <span>⚠️</span> {err}
        </p>
      )}

      <button
        type="button"
        className="btn-primary w-full !py-2.5 !text-sm font-semibold inline-flex items-center justify-center gap-2"
        disabled={busy || !stripe}
        onClick={() => void save()}
      >
        {busy ? (
          <>
            <span className="animate-spin">⏳</span>
            <span>Securing & Authorizing Card…</span>
          </>
        ) : (
          <>
            <span>Save Card for Auction Bidding</span>
            <span>↗</span>
          </>
        )}
      </button>
    </div>
  )
}

function getBrandIcon(brand: string | null) {
  const b = (brand ?? '').toLowerCase()
  if (b.includes('visa')) return '💳 Visa'
  if (b.includes('master')) return '💳 Mastercard'
  if (b.includes('amex')) return '💳 Amex'
  if (b.includes('discover')) return '💳 Discover'
  return '💳 Card'
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
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <MarketplaceNav
        title="Payment Methods"
        subtitle="Manage authorization cards for live auction bidding, high-bid escrow holding, and fast wholesale checkout."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Saved Cards List (Left 2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div
            className="rounded-2xl border p-6 space-y-4 shadow-xl"
            style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
          >
            <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
              <div>
                <h2 className="text-base font-semibold text-pleros-white">Authorized Payment Methods</h2>
                <p className="text-xs text-pleros-text-3">Auto-charged upon winning an auction lot</p>
              </div>
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: 'var(--c-surface-2)', color: 'var(--c-text-2)' }}
              >
                {pmQ.data?.length ?? 0} active
              </span>
            </div>

            {pmQ.isLoading ? (
              <p className="text-sm text-pleros-text-3 py-4 text-center">Loading payment cards…</p>
            ) : (pmQ.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon="💳"
                title="No saved payment methods"
                description="You must add a saved payment method before submitting bids in live auctions."
              />
            ) : (
              <div className="space-y-3">
                {(pmQ.data ?? []).map((pm) => (
                  <div
                    key={pm.id}
                    className="p-4 rounded-xl border flex items-center justify-between transition-all"
                    style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                        style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}
                      >
                        💳
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-pleros-white font-mono">
                            •••• •••• •••• {pm.last4}
                          </span>
                          {pm.isDefault && (
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                              Default
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-pleros-text-3">
                          {getBrandIcon(pm.brand)} · Auto-debit on auction win
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded hover:bg-red-500/10 transition-colors"
                      disabled={delMut.isPending}
                      onClick={() => void delMut.mutate(pm.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {delMut.error && <p className="text-xs text-red-400">{axiosErr(delMut.error)}</p>}
          </div>
        </div>

        {/* Add Card Form (Right 1 col) */}
        <div className="space-y-4">
          <div
            className="rounded-2xl border p-6 space-y-4 shadow-xl sticky top-6"
            style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
          >
            <div>
              <h2 className="text-base font-semibold text-pleros-white">Add New Card</h2>
              <p className="text-xs text-pleros-text-3 mt-0.5">Authorizes bidding across all live auction lots</p>
            </div>

            {stripePromise ? (
              <Elements stripe={stripePromise}>
                <AddCardForm
                  onSaved={() => void qc.invalidateQueries({ queryKey: ['marketplace', 'payment-methods'] })}
                />
              </Elements>
            ) : (
              <div className="p-4 rounded-xl border border-amber-800 bg-amber-950/30 text-xs text-amber-300">
                Stripe publishable key is not configured for this environment.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
