import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'
import { StatusBadge } from '@/components/pleros/status-badge'
import { MarketplacePaySheet } from '@/components/marketplace-pay-sheet'
import { axiosErr } from '@/lib/axios-error'
import { MarketplaceNav } from '../marketplace-nav'

type Order = {
  id: string
  listingId: string
  agreedPriceCents: number
  merchandiseSubtotalCents?: number
  taxAmountCents?: number
  taxJurisdiction?: string | null
  quantity: number
  orderStatus: string
  paymentStatus: string
  kalafleetShipmentRef: string | null
  createdAt: string
}

export default function MarketplaceOrdersPage() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'buyer' | 'seller'>('buyer')
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
    queryFn: () =>
      api.get<{ id: string; body: string; createdAt: string; sender: { handle: string }; isMine: boolean }[]>(
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

  const activeRows = activeTab === 'buyer' ? buyerQ.data : sellerQ.data
  const isLoading = activeTab === 'buyer' ? buyerQ.isLoading : sellerQ.isLoading

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <MarketplaceNav
        title="Marketplace Orders"
        subtitle="Manage purchases from other distributors and fulfill incoming wholesale orders."
      />

      {/* Role Sub-tabs */}
      <div className="flex items-center gap-3 border-b pb-3" style={{ borderColor: 'var(--c-border)' }}>
        <button
          type="button"
          onClick={() => setActiveTab('buyer')}
          className="px-4 py-2 rounded-xl text-sm font-semibold transition-all inline-flex items-center gap-2"
          style={{
            background: activeTab === 'buyer' ? 'var(--c-primary-dim)' : 'var(--c-surface)',
            color: activeTab === 'buyer' ? 'var(--c-primary)' : 'var(--c-text-2)',
            border: activeTab === 'buyer' ? '1px solid var(--c-primary)' : '1px solid var(--c-border-card)',
          }}
        >
          <span>🛍️ Purchases (Buyer)</span>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'var(--c-surface-2)', color: 'var(--c-text)' }}
          >
            {buyerQ.data?.length ?? 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('seller')}
          className="px-4 py-2 rounded-xl text-sm font-semibold transition-all inline-flex items-center gap-2"
          style={{
            background: activeTab === 'seller' ? 'var(--c-primary-dim)' : 'var(--c-surface)',
            color: activeTab === 'seller' ? 'var(--c-primary)' : 'var(--c-text-2)',
            border: activeTab === 'seller' ? '1px solid var(--c-primary)' : '1px solid var(--c-border-card)',
          }}
        >
          <span>🏷️ Sales (Seller)</span>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'var(--c-surface-2)', color: 'var(--c-text)' }}
          >
            {sellerQ.data?.length ?? 0}
          </span>
        </button>
      </div>

      {/* Modal / Dialog Overlays for Payments, Messaging, and Reviews */}
      {payOrderId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className="p-6 border rounded-2xl max-w-lg w-full shadow-2xl space-y-4"
            style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
          >
            <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
              <div>
                <h3 className="text-base font-semibold text-pleros-white">Complete Escrow Payment</h3>
                <p className="text-xs text-pleros-text-3">Order #{payOrderId.slice(-8)}</p>
              </div>
              <button
                type="button"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-pleros-text-3 hover:text-white"
                onClick={() => setPayOrderId(null)}
              >
                ✕
              </button>
            </div>
            <MarketplacePaySheet
              orderId={payOrderId}
              onPaid={() => {
                setPayOrderId(null)
                void qc.invalidateQueries({ queryKey: ['marketplace', 'orders'] })
              }}
            />
          </div>
        </div>
      )}

      {msgOrderId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className="p-6 border rounded-2xl max-w-lg w-full shadow-2xl space-y-4"
            style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
          >
            <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
              <div>
                <h3 className="text-base font-semibold text-pleros-white">Order Messages</h3>
                <p className="text-xs text-pleros-text-3">Order #{msgOrderId.slice(-8)}</p>
              </div>
              <button
                type="button"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-pleros-text-3 hover:text-white"
                onClick={() => setMsgOrderId(null)}
              >
                ✕
              </button>
            </div>

            <div
              className="p-3 rounded-xl border max-h-60 overflow-y-auto space-y-2.5"
              style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
            >
              {(msgQ.data ?? []).length === 0 ? (
                <p className="text-xs text-pleros-text-3 text-center py-4">No messages yet. Send a note below.</p>
              ) : (
                (msgQ.data ?? []).map((m) => (
                  <div
                    key={m.id}
                    className={`p-2.5 rounded-lg text-xs max-w-[85%] ${
                      m.isMine
                        ? 'ml-auto bg-pleros-primary text-pleros-white'
                        : 'mr-auto bg-zinc-800 text-zinc-200'
                    }`}
                  >
                    <div className="text-[10px] opacity-75 mb-0.5">{m.sender.handle}</div>
                    <div>{m.body}</div>
                  </div>
                ))
              )}
            </div>

            <textarea
              className="pleros-input w-full min-h-[80px] !text-xs"
              placeholder="Type message to counterparty…"
              value={msgBody}
              onChange={(e) => setMsgBody(e.target.value)}
            />

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost !text-xs" onClick={() => setMsgOrderId(null)}>
                Close
              </button>
              <button
                type="button"
                className="btn-primary !text-xs !py-2 !px-4"
                disabled={msgMut.isPending || !msgBody.trim()}
                onClick={() => void msgMut.mutate()}
              >
                {msgMut.isPending ? 'Sending…' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rateOrderId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className="p-6 border rounded-2xl max-w-md w-full shadow-2xl space-y-4"
            style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
          >
            <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
              <div>
                <h3 className="text-base font-semibold text-pleros-white">Rate Fulfillment Experience</h3>
                <p className="text-xs text-pleros-text-3">Order #{rateOrderId.slice(-8)}</p>
              </div>
              <button
                type="button"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-pleros-text-3 hover:text-white"
                onClick={() => setRateOrderId(null)}
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-pleros-text-3 mb-2">
                Score (1–5 Stars)
              </label>
              <div className="flex gap-2 text-2xl">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStars(s)}
                    className={`transition-transform hover:scale-110 ${
                      s <= stars ? 'text-amber-400' : 'text-zinc-600'
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-pleros-text-3 mb-2">
                Feedback Comment (Optional)
              </label>
              <textarea
                className="pleros-input w-full min-h-[80px] !text-xs"
                placeholder="Product packaging condition, accuracy, delivery speed…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost !text-xs" onClick={() => setRateOrderId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary !text-xs !py-2 !px-4"
                disabled={rateMut.isPending}
                onClick={() => void rateMut.mutate({ orderId: rateOrderId, stars, comment })}
              >
                {rateMut.isPending ? 'Submitting…' : 'Submit Rating'}
              </button>
            </div>
            {rateMut.error && <p className="text-xs text-red-400">{axiosErr(rateMut.error)}</p>}
          </div>
        </div>
      )}

      {/* Orders Table Container */}
      {isLoading ? (
        <div
          className="p-12 text-center rounded-2xl border text-sm text-pleros-text-3 animate-pulse"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          Loading {activeTab === 'buyer' ? 'purchases' : 'sales'}…
        </div>
      ) : (activeRows?.length ?? 0) === 0 ? (
        <EmptyState
          icon="🛒"
          title={activeTab === 'buyer' ? 'No purchase orders yet' : 'No sales orders yet'}
          description={
            activeTab === 'buyer'
              ? 'Browse the marketplace and place bids or buy-it-now orders from verified distributors.'
              : 'List inventory lots to receive wholesale orders from network partners.'
          }
        />
      ) : (
        <div
          className="rounded-2xl border overflow-hidden shadow-sm"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-xs uppercase tracking-wider border-b"
                  style={{
                    borderColor: 'var(--c-border)',
                    background: 'var(--c-surface-2)',
                    color: 'var(--c-text-3)',
                  }}
                >
                  <th className="py-3 px-4">Order ID</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Payment</th>
                  <th className="py-3 px-4 text-right">Total Amount</th>
                  <th className="py-3 px-4">Shipment Ref</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--c-border)' }}>
                {activeRows?.map((o) => (
                  <tr key={o.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-4 font-mono text-xs font-semibold text-pleros-accent">
                      #{o.id.slice(-8)}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-pleros-text-3">
                      {new Date(o.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={o.orderStatus} />
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background:
                            o.paymentStatus === 'PAID'
                              ? 'rgba(16, 185, 129, 0.15)'
                              : 'rgba(245, 158, 11, 0.15)',
                          color: o.paymentStatus === 'PAID' ? '#34d399' : '#fbbf24',
                        }}
                      >
                        {o.paymentStatus}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-medium text-pleros-white">
                      ${(o.agreedPriceCents / 100).toFixed(2)}
                      {(o.taxAmountCents ?? 0) > 0 && (
                        <span className="block text-[10px] text-pleros-text-3 font-normal">
                          incl. ${((o.taxAmountCents ?? 0) / 100).toFixed(2)} tax
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-xs">
                      {o.kalafleetShipmentRef ? (
                        <span className="font-mono text-pleros-text-2 bg-zinc-800/80 px-2 py-1 rounded">
                          {o.kalafleetShipmentRef}
                        </span>
                      ) : (
                        <span className="text-pleros-text-3">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {activeTab === 'buyer' && o.orderStatus === 'PENDING_PAYMENT' && (
                          <button
                            type="button"
                            className="btn-primary !text-xs !py-1 !px-2.5"
                            onClick={() => setPayOrderId(o.id)}
                          >
                            Pay Escrow
                          </button>
                        )}
                        {activeTab === 'buyer' &&
                          (o.orderStatus === 'DELIVERED' || o.orderStatus === 'COMPLETED') && (
                            <button
                              type="button"
                              className="btn-ghost !text-xs !py-1 !px-2.5"
                              onClick={() => setRateOrderId(o.id)}
                            >
                              ★ Rate
                            </button>
                          )}
                        <button
                          type="button"
                          className="btn-ghost !text-xs !py-1 !px-2.5"
                          onClick={() => setMsgOrderId(o.id)}
                        >
                          💬 Message
                        </button>
                        {(o.orderStatus === 'IN_FULFILLMENT' || o.orderStatus === 'DELIVERED') && (
                          <button
                            type="button"
                            className="text-xs text-red-400 hover:text-red-300 ml-1"
                            disabled={disputeMut.isPending}
                            onClick={() => void disputeMut.mutate(o.id)}
                          >
                            Dispute
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
