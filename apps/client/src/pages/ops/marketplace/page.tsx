import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'
import { axiosErr } from '@/lib/axios-error'

type Listing = {
  id: string
  title: string
  category: string
  listingType?: 'FIXED' | 'AUCTION'
  priceCents: number
  quantity: number
  auctionDurationDays?: number | null
  seller: { handle: string }
}

type OpsOrder = {
  id: string
  listingTitle: string
  buyerLabel: string
  sellerLabel: string
  buyerTenantId: string
  sellerTenantId: string
  agreedPriceCents: number
  orderStatus: string
  paymentStatus: string
  kalafleetShipmentRef: string | null
  escrowReleaseAt: string | null
  deliveryConfirmedAt: string | null
  disputeStatus: string | null
}

type Tab = 'review' | 'fulfillment' | 'escrow' | 'disputed'

export default function OpsMarketplacePage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('review')
  const [shipmentRef, setShipmentRef] = useState<Record<string, string>>({})
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [resolveOrderId, setResolveOrderId] = useState<string | null>(null)
  const [resolveNotes, setResolveNotes] = useState('')
  const [refundBuyer, setRefundBuyer] = useState(false)
  const [releaseToSeller, setReleaseToSeller] = useState(false)

  const pendingQ = useQuery({
    queryKey: ['pleros-ops', 'marketplace', 'listings'],
    queryFn: () => api.get<Listing[]>('/pleros-ops/marketplace/listings/pending'),
    enabled: tab === 'review',
  })

  const ordersQ = useQuery({
    queryKey: ['pleros-ops', 'marketplace', 'orders', tab],
    queryFn: () => {
      const queue =
        tab === 'fulfillment' ? 'fulfillment' : tab === 'escrow' ? 'escrow' : tab === 'disputed' ? 'disputed' : 'all'
      return api.get<OpsOrder[]>(`/pleros-ops/marketplace/orders?queue=${queue}`)
    },
    enabled: tab !== 'review',
  })

  const approveMut = useMutation({
    mutationFn: (id: string) => api.post(`/pleros-ops/marketplace/listings/${encodeURIComponent(id)}/approve`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pleros-ops'] }),
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/pleros-ops/marketplace/listings/${encodeURIComponent(id)}/reject`, { reason }),
    onSuccess: () => {
      setRejectId(null)
      setRejectReason('')
      void qc.invalidateQueries({ queryKey: ['pleros-ops'] })
    },
  })

  const shipmentMut = useMutation({
    mutationFn: ({ orderId, ref }: { orderId: string; ref: string }) =>
      api.post(`/pleros-ops/marketplace/orders/${encodeURIComponent(orderId)}/shipment`, { shipmentRef: ref }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pleros-ops'] }),
  })

  const deliverMut = useMutation({
    mutationFn: (orderId: string) =>
      api.post(`/pleros-ops/marketplace/orders/${encodeURIComponent(orderId)}/deliver`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pleros-ops'] }),
  })

  const escrowMut = useMutation({
    mutationFn: (orderId: string) =>
      api.post(`/pleros-ops/marketplace/orders/${encodeURIComponent(orderId)}/release-escrow`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pleros-ops'] }),
  })

  const closeAuctionsMut = useMutation({
    mutationFn: () => api.post<{ closed: number }>('/pleros-ops/marketplace/auctions/close-expired', {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pleros-ops'] }),
  })

  const jobsMut = useMutation<{ auctionsClosed: number; escrowsReleased: number }>({
    mutationFn: () =>
      api.post<{ auctionsClosed: number; escrowsReleased: number }>('/pleros-ops/marketplace/jobs/run', {}),
  })

  const resolveMut = useMutation({
    mutationFn: (orderId: string) =>
      api.post(`/pleros-ops/marketplace/orders/${encodeURIComponent(orderId)}/dispute/resolve`, {
        resolutionNotes: resolveNotes,
        refundBuyer,
        releaseToSeller,
      }),
    onSuccess: () => {
      setResolveOrderId(null)
      setResolveNotes('')
      void qc.invalidateQueries({ queryKey: ['pleros-ops'] })
    },
  })

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      className={tab === id ? 'btn-primary text-sm' : 'neo-btn-secondary text-sm px-3 py-2 rounded'}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  )

  return (
    <div>
      <h1 className="text-2xl font-display text-pleros-white">Marketplace operations</h1>
      <p className="text-sm text-pleros-text-3 mt-1">
        Internal Pleros console — listing review, Kalafleet shipment, delivery, and escrow release. Not visible in
        tenant ERP.
      </p>

      <div className="flex flex-wrap gap-2 mt-6">
        {tabBtn('review', 'Listing review')}
        {tabBtn('fulfillment', 'Fulfillment')}
        {tabBtn('escrow', 'Escrow release')}
        {tabBtn('disputed', 'Disputes')}
      </div>

      {tab === 'review' && (
        <section className="mt-6">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
              type="button"
              className="neo-btn-secondary text-sm px-3 py-2 rounded"
              disabled={closeAuctionsMut.isPending}
              onClick={() => void closeAuctionsMut.mutate()}
            >
              {closeAuctionsMut.isPending ? 'Closing…' : 'Close expired auctions'}
            </button>
            <button type="button" className="neo-btn-secondary text-sm px-3 py-2 rounded" onClick={() => void jobsMut.mutate()}>
              Run marketplace jobs
            </button>
            {jobsMut.data && (
              <span className="text-xs text-pleros-text-3">
                Jobs: {jobsMut.data.auctionsClosed} auctions, {jobsMut.data.escrowsReleased} escrows
              </span>
            )}
            {closeAuctionsMut.data != null && (
              <span className="text-xs text-pleros-text-3">Closed {closeAuctionsMut.data.closed} auction(s)</span>
            )}
          </div>
          {pendingQ.isLoading && <p className="text-sm text-pleros-text-3">Loading…</p>}
          {!pendingQ.isLoading && (pendingQ.data?.length ?? 0) === 0 && (
            <EmptyState icon="📦" title="No pending listings" description="" />
          )}
          <ul className="grid gap-3 mt-2">
            {(pendingQ.data ?? []).map((l) => (
              <li
                key={l.id}
                className="border rounded-lg p-4 flex flex-wrap justify-between gap-3"
                style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
              >
                <div>
                  <p className="font-medium text-pleros-white">{l.title}</p>
                  <p className="text-xs text-pleros-text-3 mt-1">
                    {l.category} ·{' '}
                    {l.listingType === 'AUCTION'
                      ? `Auction · start $${(l.priceCents / 100).toFixed(2)} · ${l.auctionDurationDays ?? 7}d`
                      : `$${(l.priceCents / 100).toFixed(2)} · qty ${l.quantity}`}{' '}
                    · seller {l.seller.handle}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-primary text-sm" onClick={() => void approveMut.mutate(l.id)}>
                    Approve
                  </button>
                  <button type="button" className="neo-btn-secondary text-sm px-3 py-2 rounded" onClick={() => setRejectId(l.id)}>
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {rejectId && (
            <div className="mt-4 p-4 border rounded-lg max-w-md" style={{ borderColor: 'var(--c-border-card)' }}>
              <textarea
                className="pleros-input w-full min-h-20"
                placeholder="Rejection reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary text-sm mt-2"
                onClick={() => void rejectMut.mutate({ id: rejectId, reason: rejectReason })}
              >
                Confirm reject
              </button>
            </div>
          )}
        </section>
      )}

      {tab !== 'review' && (
        <section className="mt-6 overflow-x-auto">
          {(ordersQ.data?.length ?? 0) === 0 && !ordersQ.isLoading && (
            <EmptyState icon="📋" title="No orders in this queue" description="" />
          )}
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-pleros-text-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
                <th className="py-2">Order</th>
                <th>Listing</th>
                <th>Buyer / Seller</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(ordersQ.data ?? []).map((o) => (
                <tr key={o.id} className="border-b align-top" style={{ borderColor: 'var(--c-border)' }}>
                  <td className="py-2 font-mono text-xs">{o.id.slice(-8)}</td>
                  <td>{o.listingTitle}</td>
                  <td className="text-xs">
                    <div>B: {o.buyerLabel}</div>
                    <div>S: {o.sellerLabel}</div>
                  </td>
                  <td>{o.orderStatus}</td>
                  <td className="text-xs">
                    <div>{o.paymentStatus}</div>
                    {o.kalafleetShipmentRef && <div>KF: {o.kalafleetShipmentRef}</div>}
                    {o.escrowReleaseAt && <div>Release after: {new Date(o.escrowReleaseAt).toLocaleDateString()}</div>}
                    {o.disputeStatus && <div className="text-red-400">Dispute: {o.disputeStatus}</div>}
                  </td>
                  <td className="py-2">
                    {tab === 'fulfillment' && o.orderStatus === 'PAYMENT_HELD' && (
                      <div className="flex flex-col gap-1 min-w-[180px]">
                        <input
                          className="pleros-input text-xs"
                          placeholder="Kalafleet ref"
                          value={shipmentRef[o.id] ?? ''}
                          onChange={(e) => setShipmentRef((prev) => ({ ...prev, [o.id]: e.target.value }))}
                        />
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          onClick={() =>
                            void shipmentMut.mutate({ orderId: o.id, ref: shipmentRef[o.id] ?? '' })
                          }
                        >
                          Assign shipment
                        </button>
                      </div>
                    )}
                    {tab === 'fulfillment' && o.orderStatus === 'IN_FULFILLMENT' && (
                      <button type="button" className="btn-primary text-xs" onClick={() => void deliverMut.mutate(o.id)}>
                        Confirm delivery
                      </button>
                    )}
                    {tab === 'escrow' && o.orderStatus === 'DELIVERED' && o.paymentStatus === 'ESCROW_HELD' && (
                      <button type="button" className="btn-primary text-xs" onClick={() => void escrowMut.mutate(o.id)}>
                        Release escrow
                      </button>
                    )}
                    {tab === 'disputed' && o.disputeStatus === 'OPEN' && (
                      <button type="button" className="btn-primary text-xs" onClick={() => setResolveOrderId(o.id)}>
                        Resolve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {resolveOrderId && (
            <div className="mt-4 p-4 border rounded-lg max-w-lg" style={{ borderColor: 'var(--c-border-card)' }}>
              <p className="text-sm font-medium text-pleros-white">Resolve dispute …{resolveOrderId.slice(-8)}</p>
              <textarea
                className="pleros-input w-full min-h-20 mt-2"
                placeholder="Resolution notes"
                value={resolveNotes}
                onChange={(e) => setResolveNotes(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm mt-2">
                <input type="checkbox" checked={refundBuyer} onChange={(e) => setRefundBuyer(e.target.checked)} />
                Refund buyer
              </label>
              <label className="flex items-center gap-2 text-sm mt-1">
                <input type="checkbox" checked={releaseToSeller} onChange={(e) => setReleaseToSeller(e.target.checked)} />
                Release escrow to seller
              </label>
              <button type="button" className="btn-primary text-sm mt-3" onClick={() => void resolveMut.mutate(resolveOrderId)}>
                Confirm resolution
              </button>
            </div>
          )}
          {(shipmentMut.error || deliverMut.error || escrowMut.error || resolveMut.error) && (
            <p className="text-sm text-red-400 mt-2">
              {axiosErr(shipmentMut.error ?? deliverMut.error ?? escrowMut.error ?? resolveMut.error)}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
