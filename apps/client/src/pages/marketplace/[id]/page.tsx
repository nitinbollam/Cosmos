import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'
import { StatusBadge } from '@/components/pleros/status-badge'

type Seller = {
  handle: string
  ratingAvg: number
  ratingCount: number
  completedOrderCount: number
  avgResponseTimeHours: number
  joinedAt: string
}

type FixedListing = {
  listingType: 'FIXED'
  id: string
  title: string
  description: string | null
  photoUrls?: string[]
  priceCents: number
  quantity: number
  category: string
  status: string
  seller: Seller
}

type AuctionBid = {
  id: string
  amountCents: number
  createdAt: string
  bidder: { handle: string; ratingAvg: number; ratingCount: number; completedOrderCount: number; joinedAt: string }
}

type AuctionListing = {
  listingType: 'AUCTION'
  id: string
  title: string
  description: string | null
  photoUrls?: string[]
  startingPriceCents: number
  currentHighBidCents: number | null
  minNextBidCents: number | null
  reserveNotMet?: boolean
  endsAt: string | null
  status: string
  category: string
  seller: Seller
  bids: AuctionBid[]
}

type Listing = FixedListing | AuctionListing

function useCountdown(endsAt: string | null | undefined, enabled: boolean) {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !endsAt) {
      setLabel(null)
      return
    }
    const tick = () => {
      const end = new Date(endsAt)
      const ms = end.getTime() - Date.now()
      if (ms <= 0) {
        setLabel('Ended')
        return
      }
      const d = Math.floor(ms / 86400000)
      const h = Math.floor((ms % 86400000) / 3600000)
      const m = Math.floor((ms % 3600000) / 60000)
      const s = Math.floor((ms % 60000) / 1000)
      if (d > 0) setLabel(`${d}d ${h}h ${m}m`)
      else if (h > 0) setLabel(`${h}h ${m}m ${s}s`)
      else setLabel(`${m}m ${s}s`)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [endsAt, enabled])

  return label
}

export default function MarketplaceListingDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const isAdmin = location.pathname.startsWith('/admin')
  const basePath = isAdmin ? '/admin/marketplace' : '/marketplace'

  const qc = useQueryClient()
  const [bidAmount, setBidAmount] = useState('')
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState(0)

  const listingQ = useQuery({
    queryKey: ['marketplace', 'listing', id],
    queryFn: () => api.get<Listing>(`/marketplace/listings/${encodeURIComponent(id!)}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.listingType === 'AUCTION' && q.state.data.status === 'LIVE' ? 15000 : false),
  })

  const listing = listingQ.data
  const isAuction = listing?.listingType === 'AUCTION'
  const auction = isAuction ? (listing as AuctionListing) : null
  const countdown = useCountdown(auction?.endsAt, isAuction && auction?.status === 'LIVE')

  useEffect(() => {
    if (auction?.minNextBidCents != null && !bidAmount) {
      setBidAmount((auction.minNextBidCents / 100).toFixed(2))
    }
  }, [auction?.minNextBidCents, bidAmount])

  const buyMut = useMutation({
    mutationFn: () => api.post('/marketplace/orders', { listingId: id, quantity: 1 }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['marketplace', 'orders'] })
      navigate(`${basePath}/orders`)
    },
  })

  const bidMut = useMutation({
    mutationFn: () =>
      api.post(`/marketplace/auctions/${encodeURIComponent(id!)}/bids`, {
        amountCents: Math.round(Number.parseFloat(bidAmount) * 100),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['marketplace', 'listing', id] })
      void qc.invalidateQueries({ queryKey: ['marketplace', 'listings'] })
    },
  })

  const photos = ((isAuction ? auction?.photoUrls : (listing as FixedListing)?.photoUrls) ?? [])

  function addBidIncrement(dollars: number) {
    const currentVal = Number.parseFloat(bidAmount) || ((auction?.minNextBidCents ?? 0) / 100)
    setBidAmount((currentVal + dollars).toFixed(2))
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-2 text-xs text-pleros-text-3">
        <Link to={basePath} className="hover:text-pleros-accent transition-colors flex items-center gap-1">
          <span>←</span>
          <span>Back to Marketplace</span>
        </Link>
        <span>/</span>
        <span className="text-pleros-text-2">{listing?.category || 'Wholesale Lot'}</span>
        <span>/</span>
        <span className="text-pleros-white truncate max-w-xs">{listing?.title || 'Listing Detail'}</span>
      </div>

      {listingQ.isLoading && (
        <div
          className="p-12 text-center rounded-2xl border text-sm text-pleros-text-3 animate-pulse"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          Loading listing details…
        </div>
      )}

      {listing && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Main Detail & Media (Left 2 cols) */}
          <div className="lg:col-span-2 space-y-6">
            <div
              className="rounded-2xl border p-6 sm:p-8 space-y-6 shadow-xl"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
            >
              {/* Header Badges & Title */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={listing.status} />
                  {isAuction ? (
                    <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-pleros-accent text-pleros-white">
                      🔨 Timed Auction
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-white/10">
                      🏷️ Fixed Price
                    </span>
                  )}
                  <span
                    className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                    style={{ background: 'var(--c-surface-2)', color: 'var(--c-text-2)' }}
                  >
                    {listing.category}
                  </span>
                </div>

                <h1 className="text-2xl sm:text-3xl font-bold font-display text-pleros-white">
                  {listing.title}
                </h1>
              </div>

              {/* Photo Gallery */}
              {photos.length > 0 ? (
                <div className="space-y-3">
                  <div className="aspect-video w-full rounded-xl overflow-hidden bg-black/40 border flex items-center justify-center relative shadow-inner" style={{ borderColor: 'var(--c-border)' }}>
                    <img
                      src={photos[selectedPhotoIdx] ?? photos[0]}
                      alt={listing.title}
                      className="w-full h-full object-contain"
                    />
                  </div>

                  {photos.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {photos.map((url, i) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => setSelectedPhotoIdx(i)}
                          className={`relative aspect-square w-16 sm:w-20 rounded-lg overflow-hidden border transition-all shrink-0 ${
                            selectedPhotoIdx === i ? 'ring-2 ring-pleros-primary' : 'opacity-70 hover:opacity-100'
                          }`}
                          style={{ borderColor: 'var(--c-border)' }}
                        >
                          <img src={url} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className="aspect-video w-full rounded-xl border flex flex-col items-center justify-center text-pleros-text-3 gap-2"
                  style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
                >
                  <span className="text-4xl">📦</span>
                  <span className="text-xs">No media provided by seller</span>
                </div>
              )}

              {/* Description */}
              <div className="pt-4 border-t space-y-2" style={{ borderColor: 'var(--c-border)' }}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3">
                  Product Details & Specifications
                </h3>
                <p className="text-sm text-pleros-text leading-relaxed whitespace-pre-wrap">
                  {listing.description || 'No additional specifications provided for this lot.'}
                </p>
              </div>

              {/* Seller Trust Profile */}
              <div
                className="p-4 rounded-xl border flex items-center justify-between"
                style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    <span className="font-semibold text-pleros-white text-sm">{listing.seller.handle}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
                      Verified Distributor
                    </span>
                  </div>
                  <p className="text-xs text-pleros-text-3">
                    ★ {listing.seller.ratingAvg.toFixed(1)} ({listing.seller.ratingCount} reviews) ·{' '}
                    {listing.seller.completedOrderCount} orders fulfilled
                    {listing.seller.avgResponseTimeHours > 0 &&
                      ` · ~${listing.seller.avgResponseTimeHours.toFixed(0)}h response`}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Action & Bidding Sidebar (Right 1 col) */}
          <div className="space-y-6 sticky top-6">
            <div
              className="rounded-2xl border p-6 space-y-6 shadow-xl"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
            >
              {isAuction && auction ? (
                <>
                  <div className="space-y-1 pb-4 border-b" style={{ borderColor: 'var(--c-border)' }}>
                    <span className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3">
                      {auction.currentHighBidCents != null ? 'Current High Bid' : 'Starting Bid'}
                    </span>
                    <div className="text-3xl font-mono font-bold text-pleros-white">
                      $
                      {(
                        (auction.currentHighBidCents != null
                          ? auction.currentHighBidCents
                          : auction.startingPriceCents) / 100
                      ).toFixed(2)}
                    </div>

                    {auction.status === 'LIVE' && countdown && (
                      <div className="flex items-center gap-2 pt-1 text-sm font-medium text-pleros-accent">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pleros-accent opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-pleros-accent" />
                        </span>
                        <span>{countdown} remaining</span>
                      </div>
                    )}

                    {auction.reserveNotMet && auction.status === 'LIVE' && (
                      <span className="inline-block text-xs font-medium text-amber-400 mt-1">
                        ⚠️ Reserve price not yet met
                      </span>
                    )}

                    {auction.status === 'ENDED' && (
                      <p className="text-xs text-pleros-text-3 mt-1">This auction has ended.</p>
                    )}

                    {auction.status === 'SOLD' && (
                      <div className="mt-2 p-3 rounded-xl border border-green-500/30 bg-green-500/10 text-xs text-green-400">
                        Auction completed & sold.
                      </div>
                    )}
                  </div>

                  {auction.status === 'LIVE' && (
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3">
                            Your Bid (USD)
                          </label>
                          {auction.minNextBidCents != null && (
                            <span className="text-[11px] text-pleros-text-3">
                              Min: ${(auction.minNextBidCents / 100).toFixed(2)}
                            </span>
                          )}
                        </div>

                        <div className="relative">
                          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-base text-pleros-text-3">
                            $
                          </span>
                          <input
                            type="number"
                            step="1"
                            className="pleros-input w-full !pl-8 !py-3 !text-lg font-mono font-bold"
                            value={bidAmount}
                            onChange={(e) => setBidAmount(e.target.value)}
                          />
                        </div>

                        {/* Quick increment buttons */}
                        <div className="grid grid-cols-4 gap-1.5 mt-2">
                          {[10, 25, 50, 100].map((inc) => (
                            <button
                              key={inc}
                              type="button"
                              onClick={() => addBidIncrement(inc)}
                              className="px-2 py-1.5 rounded-lg border text-xs font-mono font-medium hover:border-pleros-primary transition-colors"
                              style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
                            >
                              +${inc}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn-primary w-full !py-3 !text-base font-bold shadow-lg"
                        disabled={bidMut.isPending || !bidAmount}
                        onClick={() => void bidMut.mutate()}
                      >
                        {bidMut.isPending ? 'Submitting Bid…' : 'Place Bid ↗'}
                      </button>

                      {bidMut.error && (
                        <p className="text-xs text-red-400 p-2.5 rounded bg-red-950/30 border border-red-800">
                          {axiosErr(bidMut.error)}
                        </p>
                      )}

                      <p className="text-[11px] text-pleros-text-3 text-center">
                        Requires a{' '}
                        <Link to={`${basePath}/payment-methods`} className="text-pleros-accent hover:underline">
                          saved payment method
                        </Link>{' '}
                        for escrow hold upon winning.
                      </p>
                    </div>
                  )}

                  {/* Recent Bids Log */}
                  {auction.bids.length > 0 && (
                    <div className="pt-4 border-t space-y-2.5" style={{ borderColor: 'var(--c-border)' }}>
                      <span className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3 block">
                        Recent Bids ({auction.bids.length})
                      </span>
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {auction.bids.map((b, idx) => (
                          <div
                            key={b.id}
                            className="p-2.5 rounded-lg border flex items-center justify-between text-xs"
                            style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
                          >
                            <div className="space-y-0.5">
                              <span className="font-semibold text-pleros-white">
                                {b.bidder.handle} {idx === 0 && '👑'}
                              </span>
                              <span className="text-[10px] text-pleros-text-3 block">
                                {new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <span className="font-mono font-bold text-pleros-white">
                              ${(b.amountCents / 100).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Fixed Price Action Box */
                <>
                  <div className="space-y-1 pb-4 border-b" style={{ borderColor: 'var(--c-border)' }}>
                    <span className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3">
                      Wholesale Price
                    </span>
                    <div className="text-3xl font-mono font-bold text-pleros-white">
                      ${(((listing as FixedListing).priceCents) / 100).toFixed(2)}
                    </div>
                    <p className="text-xs text-pleros-text-3">
                      Available lot quantity: <strong className="text-pleros-white">{(listing as FixedListing).quantity}</strong>
                    </p>
                  </div>

                  <button
                    type="button"
                    className="btn-primary w-full !py-3 !text-base font-bold shadow-lg"
                    disabled={buyMut.isPending || (listing as FixedListing).quantity < 1}
                    onClick={() => void buyMut.mutate()}
                  >
                    {buyMut.isPending ? 'Placing Order…' : 'Buy Now ↗'}
                  </button>

                  {buyMut.error && (
                    <p className="text-xs text-red-400 p-2.5 rounded bg-red-950/30 border border-red-800">
                      {axiosErr(buyMut.error)}
                    </p>
                  )}

                  <div className="text-[11px] text-pleros-text-3 space-y-1.5 pt-2">
                    <p>✓ Guaranteed distributor stock inspection.</p>
                    <p>✓ Escrow settlement via connected Stripe account.</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
