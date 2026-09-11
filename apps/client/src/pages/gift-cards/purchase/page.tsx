import { useState } from 'react'
import { api } from '@/lib/api'
import { getB2bCustomerId } from '@/lib/session'
import { useNavigate } from 'react-router-dom'
import { axiosErr } from '@/lib/axios-error'

export default function GiftCardPurchasePage() {
  const navigate = useNavigate()
  const [amount, setAmount] = useState('50')
  const [err, setErr] = useState<string | null>(null)
  const [issuedCode, setIssuedCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function purchase() {
    const cid = getB2bCustomerId()
    if (!cid) {
      navigate('/login')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const card = await api.post<{ code: string }>('/gift-cards/purchase', {
        amount: Number(amount),
        issuedToCustomerId: cid,
      })
      setIssuedCode(card.code)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--c-heading)' }}>Purchase gift card</h1>
      {issuedCode ? (
        <div className="pleros-card mt-4">
          <p style={{ color: 'var(--c-success)' }}>Gift card issued — check your email for the code.</p>
          <p className="font-mono text-lg mt-2">{issuedCode}</p>
        </div>
      ) : (
        <div className="pleros-card mt-4 space-y-4">
          <label className="text-xs" style={{ color: 'var(--c-text-3)' }}>
            Amount ($)
          </label>
          <input className="pleros-input w-full" type="number" min={5} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          {err ? <p style={{ color: 'var(--c-danger)' }}>{err}</p> : null}
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void purchase()}>
            {busy ? 'Processing…' : 'Buy gift card'}
          </button>
        </div>
      )}
    </div>
  )
}
