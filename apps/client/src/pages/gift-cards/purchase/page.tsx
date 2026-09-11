import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { getB2bCustomerId } from '@/lib/session'
import { useNavigate, Link } from 'react-router-dom'
import { axiosErr } from '@/lib/axios-error'
import { useQuery } from '@tanstack/react-query'

type SavedCard = {
  id: string
  brand?: string
  last4?: string
  expMonth?: number
  expYear?: number
  isDefault?: boolean
}

export default function GiftCardPurchasePage() {
  const navigate = useNavigate()
  const [amount, setAmount] = useState('50')
  const [selectedMethodId, setSelectedMethodId] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [issuedCode, setIssuedCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const cardsQ = useQuery<SavedCard[]>({
    queryKey: ['saved-payment-methods'],
    queryFn: () => api.get<SavedCard[]>('/saved-payment-methods'),
  })

  const cards = cardsQ.data ?? []

  useEffect(() => {
    if (cards.length > 0 && !selectedMethodId) {
      const def = cards.find((c) => c.isDefault) ?? cards[0]
      if (def) setSelectedMethodId(def.id)
    }
  }, [cards, selectedMethodId])

  async function purchase() {
    const cid = getB2bCustomerId()
    if (!cid) {
      navigate('/login')
      return
    }
    if (!selectedMethodId) {
      setErr('Please select or add a payment method first.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const card = await api.post<{ code: string }>('/gift-cards/purchase', {
        amount: Number(amount),
        savedPaymentMethodId: selectedMethodId,
      })
      setIssuedCode(card.code)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <div>
        <Link to="/account" className="text-xs text-pleros-accent hover:underline mb-2 inline-block">
          ← Back to Account
        </Link>
        <h1 className="text-2xl font-bold font-display text-pleros-white">Purchase Gift Card</h1>
        <p className="text-sm text-pleros-text-3 mt-1">
          Issue digital store credit with immediate balance tracking.
        </p>
      </div>

      {issuedCode ? (
        <div className="pleros-card space-y-4 border border-emerald-500/30 bg-emerald-500/10">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <span>✓</span> Gift card issued successfully
          </div>
          <p className="text-sm text-pleros-text-2">
            Your gift card code is ready to use at checkout:
          </p>
          <div className="p-3 bg-black/40 rounded border border-emerald-500/30 text-center">
            <span className="font-mono text-xl tracking-wider text-emerald-300 font-bold select-all">
              {issuedCode}
            </span>
          </div>
          <div className="pt-2">
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => {
                setIssuedCode(null)
                setAmount('50')
              }}
            >
              Purchase another card
            </button>
          </div>
        </div>
      ) : (
        <div className="pleros-card space-y-5">
          <div>
            <label className="text-xs font-medium text-pleros-text-3">Gift Card Amount ($)</label>
            <div className="grid grid-cols-4 gap-2 mt-2">
              {['25', '50', '100', '250'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`px-3 py-2 text-sm rounded border transition-colors ${
                    amount === preset
                      ? 'bg-pleros-accent text-white border-pleros-accent'
                      : 'bg-pleros-surface-2 border-pleros-border text-pleros-text-2 hover:border-pleros-accent/60'
                  }`}
                  onClick={() => setAmount(preset)}
                >
                  ${preset}
                </button>
              ))}
            </div>
            <input
              className="pleros-input w-full mt-3 font-mono"
              type="number"
              min={5}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Custom amount"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-pleros-text-3">Payment Method</label>
            {cardsQ.isLoading ? (
              <p className="text-xs text-pleros-text-3 mt-2">Loading payment methods…</p>
            ) : cards.length > 0 ? (
              <select
                className="pleros-input w-full mt-2"
                value={selectedMethodId}
                onChange={(e) => setSelectedMethodId(e.target.value)}
              >
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.brand?.toUpperCase() ?? 'CARD'} •••• {c.last4 ?? '????'}
                    {c.isDefault ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-2 p-3 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
                No payment method on file. Please add a credit card in your{' '}
                <Link to="/account" className="underline font-semibold">
                  Account settings
                </Link>{' '}
                first.
              </div>
            )}
          </div>

          {err ? <p className="text-xs text-red-400 mt-2">{err}</p> : null}

          <button
            type="button"
            className="btn-primary w-full text-center"
            disabled={busy || !cards.length || Number(amount) <= 0}
            onClick={() => void purchase()}
          >
            {busy ? 'Processing payment…' : `Pay $${Number(amount || 0).toFixed(2)} & Issue Card`}
          </button>
        </div>
      )}
    </div>
  )
}
