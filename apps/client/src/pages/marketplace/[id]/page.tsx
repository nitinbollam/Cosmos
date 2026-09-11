import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'

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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link to={basePath} className="text-sm text-pleros-accent hover:underline">
        ← Marketplace
      </Link>
      {listingQ.isLoading && <p className="mt-4 text-sm text-pleros-text-3">Loading…</p>}
      {listing && (
        <div className="mt-4 max-w-2xl">
          <div className="flex items-start gap-2">
            <h1 className="text-2xl font-display text-pleros-white">{listing.title}</h1>
            {isAuction && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-pleros-accent/20 text-pleros-accent mt-1">
                Auction
              </span>
            )}
          </div>
          <p className="text-sm text-pleros-text-3 mt-1">{listing.category}</p>
          {((isAuction ? auction?.photoUrls : (listing as FixedListing).photoUrls) ?? []).length > 0 && (
            <div className="flex gap-2 mt-4 flex-wrap">
              {((isAuction ? auction?.photoUrls : (listing as FixedListing).photoUrls) ?? []).map((url) => (
                <img key={url} src={url} alt="" className="w-32 h-32 object-cover rounded" />
              ))}
            </div>
          )}
          {listing.description && <p className="mt-4 text-pleros-text">{listing.description}</p>}

          {isAuction && auction ? (
            <>
              <div className="mt-4 space-y-1">
                <p className="text-lg font-medium">
                  {auction.currentHighBidCents != null
                    ? `Current bid: $${(auction.currentHighBidCents / 100).toFixed(2)}`
                    : `Starting bid: $${(auction.startingPriceCents / 100).toFixed(2)}`}
                </p>
                {auction.status === 'LIVE' && countdown && (
                  <p className="text-sm text-pleros-text-3">Time remaining: {countdown}</p>
                )}
                {auction.reserveNotMet && auction.status === 'LIVE' && (
                  <p className="text-sm text-amber-400">Reserve not yet met</p>
                )}
                {auction.status === 'ENDED' && (
                  <p className="text-sm text-pleros-text-3">This auction ended with no sale.</p>
                )}
                {auction.status === 'SOLD' && (
                  <div className="mt-2 p-3 rounded border border-green-500/30 bg-green-500/10">
                    <p className="text-sm text-green-400 font-medium">Auction sold</p>
                    <p className="text-sm text-pleros-text-3 mt-1">
                      Winners are auto-charged when possible. Check{' '}
                      <Link to={`${basePath}/orders`} className="text-pleros-accent">
                        My orders
                      </Link>{' '}
                      to confirm payment.
                    </p>
                  </div>
                )}
              </div>

              {auction.status === 'LIVE' && (
                <p className="text-sm mt-3">
                  <Link to={`${basePath}/payment-methods`} className="text-pleros-accent">
                    Add a payment method
                  </Link>{' '}
                  before bidding (required for auto-charge if you win).
                </p>
              )}
              {auction.status === 'LIVE' && auction.minNextBidCents != null && (
                <div className="mt-6 flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-sm">Your bid (USD)</label>
                    <input
                      className="pleros-input w-40"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                    />
                    <p className="text-xs text-pleros-text-3 mt-1">
                      Min bid ${(auction.minNextBidCents / 100).toFixed(2)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={bidMut.isPending || !bidAmount}
                    onClick={() => void bidMut.mutate()}
                  >
                    {bidMut.isPending ? 'Placing bid…' : 'Place bid'}
                  </button>
                </div>
              )}
              {bidMut.error && <p className="text-sm text-red-400 mt-2">{axiosErr(bidMut.error)}</p>}

              {auction.bids.length > 0 && (
                <div className="mt-6">
                  <h2 className="text-sm font-medium text-pleros-white">Recent bids</h2>
                  <ul className="mt-2 space-y-2">
                    {auction.bids.map((b) => (
                      <li key={b.id} className="text-sm flex justify-between gap-4">
                        <span>
                          {b.bidder.handle} · ${(b.amountCents / 100).toFixed(2)}
                        </span>
                        <span className="text-pleros-text-3">{new Date(b.createdAt).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mt-4 text-lg font-medium">${((listing as FixedListing).priceCents / 100).toFixed(2)}</p>
              <p className="text-sm text-pleros-text-3">Available: {(listing as FixedListing).quantity}</p>
              <button
                type="button"
                className="btn-primary mt-6"
                disabled={buyMut.isPending || (listing as FixedListing).quantity < 1}
                onClick={() => void buyMut.mutate()}
              >
                {buyMut.isPending ? 'Placing order…' : 'Buy now'}
              </button>
              {buyMut.error && <p className="text-sm text-red-400 mt-2">{axiosErr(buyMut.error)}</p>}
            </>
          )}

          <div
            className="mt-6 p-3 rounded border text-sm"
            style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface-2)' }}
          >
            <p className="font-medium">{listing.seller.handle}</p>
            <p className="text-pleros-text-3 mt-1">
              ★ {listing.seller.ratingAvg.toFixed(1)} ({listing.seller.ratingCount} ratings) ·{' '}
              {listing.seller.completedOrderCount} completed orders
              {listing.seller.avgResponseTimeHours > 0 &&
                ` · ~${listing.seller.avgResponseTimeHours.toFixed(0)}h avg response`}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
