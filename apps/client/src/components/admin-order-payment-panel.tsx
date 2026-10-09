import { Elements, useStripe } from '@stripe/react-stripe-js'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { AdminStripeCardForm, confirmStripeAction } from '@/components/admin-stripe-card-form'
import { useStripeConnect } from '@/lib/stripe-connect'

const stripePublishable = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? ''

function newCorrelationId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

type PaymentBlock = {
  paymentMethod: string
  paymentIntentId?: string | null
  stripeIntentId?: string | null
  stripeDashboardPaymentUrl?: string | null
  paymentStatus?: string | null
  capturedAmount?: number | null
  refundableAmount?: number
  amountPaidOnOrder?: number
  orderBalance?: number
  totalAmount: string | number
  customerId: string
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function StripeCollectInner({
  orderId,
  customerId,
  amount,
  onDone,
  onErr,
}: {
  orderId: string
  customerId: string
  amount: number
  onDone: () => void
  onErr: (msg: string) => void
}) {
  const stripe = useStripe()

  async function runPayment(paymentMethodId: string) {
    const correlationId = newCorrelationId()
    try {
      const res = await api.post<{
        requiresAction?: boolean
        clientSecret?: string
        paymentIntentId?: string
      }>(
        `/orders/${encodeURIComponent(orderId)}/payments/stripe`,
        { paymentMethodId, amount, correlationId, customerId },
        { 'Idempotency-Key': correlationId },
      )
      if (res.requiresAction && res.clientSecret && stripe) {
        const confirmed = await confirmStripeAction(stripe, res.clientSecret)
        if (!confirmed.ok) {
          onErr(confirmed.error ?? 'Authentication failed')
          return
        }
        if (res.paymentIntentId) {
          await api.post(`/orders/${encodeURIComponent(orderId)}/payments/confirm-stripe`, {
            paymentIntentId: res.paymentIntentId,
            correlationId: newCorrelationId(),
          })
        }
      }
      onDone()
    } catch (e: unknown) {
      onErr(e instanceof Error ? e.message : 'Payment failed')
    }
  }

  return <AdminStripeCardForm submitLabel={`Charge ${money(amount)}`} onSubmit={(r) => runPayment(r.paymentMethodId)} />
}

export function AdminOrderPaymentPanel({ orderId, data }: { orderId: string; data: PaymentBlock }) {
  const qc = useQueryClient()
  const { stripePromise, chargesEnabled, loading: stripeLoading } = useStripeConnect(api.get.bind(api), 'admin-stripe')

  const [mode, setMode] = useState<'none' | 'collect' | 'refund' | 'manual'>('none')
  const [refundAmount, setRefundAmount] = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const [manualMethod, setManualMethod] = useState<'CASH' | 'CHECK' | 'ACH'>('ACH')
  const [err, setErr] = useState<string | null>(null)

  const balance = data.orderBalance ?? Math.max(0, Number(data.totalAmount) - Number(data.amountPaidOnOrder ?? 0))
  const refundable = data.refundableAmount ?? 0

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['order', orderId] })
    void qc.invalidateQueries({ queryKey: ['finance', 'invoices-ar'] })
  }

  const captureMut = useMutation({
    mutationFn: async () => {
      const correlationId = newCorrelationId()
      await api.post(
        `/orders/${encodeURIComponent(orderId)}/payments/capture`,
        { correlationId },
        { 'Idempotency-Key': correlationId },
      )
    },
    onSuccess: () => {
      invalidate()
      setErr(null)
    },
    onError: (e: Error) => setErr(e.message),
  })

  const voidMut = useMutation({
    mutationFn: async () => {
      const correlationId = newCorrelationId()
      await api.post(
        `/orders/${encodeURIComponent(orderId)}/payments/void`,
        { correlationId },
        { 'Idempotency-Key': correlationId },
      )
    },
    onSuccess: () => {
      invalidate()
      setErr(null)
    },
    onError: (e: Error) => setErr(e.message),
  })

  const refundMut = useMutation({
    mutationFn: async () => {
      const amount = refundAmount.trim() ? parseFloat(refundAmount) : undefined
      const correlationId = newCorrelationId()
      await api.post(
        `/orders/${encodeURIComponent(orderId)}/payments/refund`,
        { correlationId, amount },
        { 'Idempotency-Key': correlationId },
      )
    },
    onSuccess: () => {
      invalidate()
      setMode('none')
      setRefundAmount('')
      setErr(null)
    },
    onError: (e: Error) => setErr(e.message),
  })

  const manualMut = useMutation({
    mutationFn: async () => {
      await api.post(`/orders/${encodeURIComponent(orderId)}/payments`, {
        amount: parseFloat(manualAmount),
        method: manualMethod,
      })
    },
    onSuccess: () => {
      invalidate()
      setMode('none')
      setManualAmount('')
      setErr(null)
    },
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <div className="pleros-card">
      <h3 className="text-pleros-white font-semibold font-display mb-3">Payment</h3>
      <dl className="text-sm space-y-2">
        <div className="flex justify-between gap-4">
          <dt className="text-pleros-text-3">Method</dt>
          <dd className="font-mono">{data.paymentMethod}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-pleros-text-3">Status</dt>
          <dd className="font-mono">{data.paymentStatus ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-pleros-text-3">Paid on order</dt>
          <dd className="font-mono">{money(Number(data.amountPaidOnOrder ?? 0))}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-pleros-text-3">Balance due</dt>
          <dd className="font-mono">{money(balance)}</dd>
        </div>
        {refundable > 0 ? (
          <div className="flex justify-between gap-4">
            <dt className="text-pleros-text-3">Refundable</dt>
            <dd className="font-mono text-emerald-400">{money(refundable)}</dd>
          </div>
        ) : null}
        {data.stripeIntentId ? (
          <div className="flex justify-between gap-4">
            <dt className="text-pleros-text-3">Stripe</dt>
            <dd className="font-mono text-xs truncate max-w-[200px]">{data.stripeIntentId}</dd>
          </div>
        ) : null}
      </dl>

      {data.stripeIntentId ? (
        <a
          href={
            data.stripeDashboardPaymentUrl ??
            `https://dashboard.stripe.com/payments/${encodeURIComponent(data.stripeIntentId)}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-3 text-sm text-pleros-accent hover:underline"
        >
          Open in Stripe →
        </a>
      ) : null}

      {err ? <p className="text-sm text-red-400 mt-3">{err}</p> : null}

      <div className="flex flex-wrap gap-2 mt-4">
        {data.paymentStatus === 'AUTHORIZED' ? (
          <>
            <button type="button" className="btn-primary text-sm" disabled={captureMut.isPending} onClick={() => captureMut.mutate()}>
              Capture
            </button>
            <button type="button" className="btn-ghost text-sm" disabled={voidMut.isPending} onClick={() => voidMut.mutate()}>
              Void auth
            </button>
          </>
        ) : null}
        {balance > 0.01 && stripePromise && chargesEnabled ? (
          <button type="button" className="btn-primary text-sm" onClick={() => setMode(mode === 'collect' ? 'none' : 'collect')}>
            Collect card (Stripe)
          </button>
        ) : null}
        {balance > 0.01 ? (
          <button type="button" className="btn-ghost text-sm" onClick={() => setMode(mode === 'manual' ? 'none' : 'manual')}>
            Record payment
          </button>
        ) : null}
        {refundable > 0.01 ? (
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={() => {
              setMode(mode === 'refund' ? 'none' : 'refund')
              setRefundAmount(String(refundable))
            }}
          >
            Refund to card
          </button>
        ) : null}
      </div>

      {mode === 'collect' && stripePromise ? (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--c-border)' }}>
          <Elements stripe={stripePromise} options={{ appearance: { theme: 'night' } }}>
            <StripeCollectInner
              orderId={orderId}
              customerId={data.customerId}
              amount={balance}
              onDone={() => {
                invalidate()
                setMode('none')
              }}
              onErr={setErr}
            />
          </Elements>
        </div>
      ) : null}

      {mode === 'refund' ? (
        <div className="mt-4 pt-4 border-t space-y-3" style={{ borderColor: 'var(--c-border)' }}>
          <label className="text-xs text-pleros-text-3">Refund amount (max {money(refundable)})</label>
          <input className="pleros-input" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
          <button type="button" className="btn-primary text-sm" disabled={refundMut.isPending} onClick={() => refundMut.mutate()}>
            {refundMut.isPending ? 'Refunding…' : 'Issue refund'}
          </button>
        </div>
      ) : null}

      {mode === 'manual' ? (
        <div className="mt-4 pt-4 border-t space-y-3" style={{ borderColor: 'var(--c-border)' }}>
          <input className="pleros-input" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder={String(balance)} />
          <select className="pleros-input" value={manualMethod} onChange={(e) => setManualMethod(e.target.value as typeof manualMethod)}>
            <option value="ACH">ACH</option>
            <option value="CHECK">Check</option>
            <option value="CASH">Cash</option>
          </select>
          <button type="button" className="btn-primary text-sm" disabled={manualMut.isPending} onClick={() => manualMut.mutate()}>
            Record
          </button>
        </div>
      ) : null}

      {!stripeLoading && balance > 0.01 && !chargesEnabled ? (
        <p className="text-xs text-amber-400 mt-3">
          Stripe Connect onboarding required — finish Connect in Settings → Integrations before collecting card payments.
        </p>
      ) : null}
      {!stripePublishable && balance > 0.01 ? (
        <p className="text-xs text-amber-400 mt-3">Set VITE_STRIPE_PUBLISHABLE_KEY for card collection.</p>
      ) : null}
    </div>
  )
}
