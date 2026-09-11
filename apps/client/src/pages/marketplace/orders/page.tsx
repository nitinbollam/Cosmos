import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'
import { MarketplacePaySheet } from '@/components/marketplace-pay-sheet'
import { axiosErr } from '@/lib/axios-error'

type Order = {
  id: string
  listingId: string
  agreedPriceCents: number
  quantity: number
  orderStatus: string
  paymentStatus: string
  kalafleetShipmentRef: string | null
  createdAt: string
}

export default function MarketplaceOrdersPage() {
  const qc = useQueryClient()
  const [payOrderId, setPayOrderId] = useState<string | null>(null)
  const [rateOrderId, setRateOrderId] = useState<string | null>(null)
  const [stars, setStars] = useState(5)
  const [comment, setComment] = useState('')
  const [msgOrderId, setMsgOrderId] = useState<string | null>(null)
  const [msgBody, setMsgBody] = useState('')

  const buyerQ = useQuery({
    queryKey: ['marketplace', 'orders', 'buyer'],
    queryFn: () => api.get<Order[]>('/marketplace/orders?role=buyer'),
  })

  const sellerQ = useQuery({
    queryKey: ['marketplace', 'orders', 'seller'],
    queryFn: () => api.get<Order[]>('/marketplace/orders?role=seller'),
  })

  const rateMut = useMutation({
    mutationFn: ({ orderId, stars, comment }: { orderId: string; stars: number; comment: string }) =>
      api.post(`/marketplace/orders/${encodeURIComponent(orderId)}/rate`, { stars, comment: comment || undefined }),
    onSuccess: () => {
      setRateOrderId(null)
      setComment('')
      void qc.invalidateQueries({ queryKey: ['marketplace', 'orders'] })
    },
  })

  const msgQ = useQuery({
    queryKey: ['marketplace', 'messages', msgOrderId],
    queryFn: () => api.get<{ id: string; body: string; createdAt: string; sender: { handle: string }; isMine: boolean }[]>(
      `/marketplace/orders/${encodeURIComponent(msgOrderId!)}/messages`,
    ),
    enabled: !!msgOrderId,
  })

  const msgMut = useMutation({
    mutationFn: () =>
      api.post(`/marketplace/orders/${encodeURIComponent(msgOrderId!)}/messages`, { body: msgBody }),
    onSuccess: () => {
      setMsgBody('')
      void qc.invalidateQueries({ queryKey: ['marketplace', 'messages', msgOrderId] })
    },
  })

  const disputeMut = useMutation({
    mutationFn: (orderId: string) =>
      api.post(`/marketplace/orders/${encodeURIComponent(orderId)}/dispute`, { notes: 'Buyer opened dispute' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['marketplace', 'orders'] }),
  })

  const renderTable = (rows: Order[] | undefined, empty: string, role: 'buyer' | 'seller') => {
    if (!rows?.length) return <EmptyState title={empty} description="" />
    return (
      <table className="w-full text-sm mt-2">
        <thead>
          <tr className="text-left text-pleros-text-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
            <th className="py-2">Order</th>
            <th>Status</th>
            <th>Payment</th>
            <th>Total</th>
            <th>Tracking</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="border-b align-top" style={{ borderColor: 'var(--c-border)' }}>
              <td className="py-2 font-mono text-xs">{o.id.slice(-8)}</td>
              <td>{o.orderStatus}</td>
              <td>{o.paymentStatus}</td>
              <td>${(o.agreedPriceCents / 100).toFixed(2)}</td>
              <td>{o.kalafleetShipmentRef ?? '—'}</td>
              <td className="py-2">
                {role === 'buyer' && o.orderStatus === 'PENDING_PAYMENT' && (
                  <button type="button" className="text-sm text-pleros-accent" onClick={() => setPayOrderId(o.id)}>
                    Pay
                  </button>
                )}
                {role === 'buyer' &&
                  (o.orderStatus === 'DELIVERED' || o.orderStatus === 'COMPLETED') &&
                  rateOrderId !== o.id && (
                    <button type="button" className="text-sm text-pleros-accent ml-2" onClick={() => setRateOrderId(o.id)}>
                      Rate
                    </button>
                  )}
                <button type="button" className="text-sm text-pleros-accent ml-2" onClick={() => setMsgOrderId(o.id)}>
                  Message
                </button>
                {(o.orderStatus === 'IN_FULFILLMENT' || o.orderStatus === 'DELIVERED') && (
                  <button
                    type="button"
                    className="text-sm text-red-400 ml-2"
                    disabled={disputeMut.isPending}
                    onClick={() => void disputeMut.mutate(o.id)}
                  >
                    Dispute
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div>
      <Link to="/admin/marketplace" className="text-sm text-pleros-accent">
        ← Marketplace
      </Link>
      <h1 className="text-2xl font-display text-pleros-white mt-2">My marketplace orders</h1>

      {payOrderId && (
        <div
          className="mt-4 p-4 border rounded-lg max-w-md"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          <p className="text-sm text-pleros-white font-medium">Complete payment</p>
          <MarketplacePaySheet
            orderId={payOrderId}
            onPaid={() => {
              setPayOrderId(null)
              void qc.invalidateQueries({ queryKey: ['marketplace', 'orders'] })
            }}
          />
          <button type="button" className="text-sm text-pleros-text-3 mt-2" onClick={() => setPayOrderId(null)}>
            Cancel
          </button>
        </div>
      )}

      {msgOrderId && (
        <div className="mt-4 p-4 border rounded-lg max-w-md" style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}>
          <p className="text-sm text-pleros-white font-medium">Order messages (…{msgOrderId.slice(-8)})</p>
          <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto text-sm">
            {(msgQ.data ?? []).map((m) => (
              <li key={m.id} className={m.isMine ? 'text-pleros-accent' : 'text-pleros-text'}>
                <span className="text-pleros-text-3">{m.sender.handle}:</span> {m.body}
              </li>
            ))}
          </ul>
          <textarea className="pleros-input w-full min-h-16 mt-2" value={msgBody} onChange={(e) => setMsgBody(e.target.value)} />
          <div className="flex gap-2 mt-2">
            <button type="button" className="btn-primary text-sm" disabled={msgMut.isPending} onClick={() => void msgMut.mutate()}>
              Send
            </button>
            <button type="button" className="text-sm text-pleros-text-3" onClick={() => setMsgOrderId(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {rateOrderId && (
        <div
          className="mt-4 p-4 border rounded-lg max-w-md"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          <p className="text-sm text-pleros-white font-medium">Rate this order</p>
          <label className="block text-sm mt-2">Stars (1–5)</label>
          <input
            className="pleros-input w-20"
            type="number"
            min={1}
            max={5}
            value={stars}
            onChange={(e) => setStars(Number.parseInt(e.target.value, 10))}
          />
          <label className="block text-sm mt-2">Comment (optional)</label>
          <textarea className="pleros-input w-full min-h-16" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button
            type="button"
            className="btn-primary text-sm mt-3"
            disabled={rateMut.isPending}
            onClick={() => void rateMut.mutate({ orderId: rateOrderId, stars, comment })}
          >
            Submit rating
          </button>
          {rateMut.error && <p className="text-sm text-red-400 mt-2">{axiosErr(rateMut.error)}</p>}
        </div>
      )}

      <h2 className="text-lg text-pleros-white mt-6">Purchases</h2>
      {renderTable(buyerQ.data, 'No purchases yet', 'buyer')}

      <h2 className="text-lg text-pleros-white mt-8">Sales</h2>
      {renderTable(sellerQ.data, 'No sales yet', 'seller')}
    </div>
  )
}
