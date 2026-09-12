import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'
import { StatusBadge } from '@/components/pleros/status-badge'
import { MarketplaceNav } from '../marketplace-nav'

type Listing = {
  id: string
  title: string
  listingType: 'FIXED' | 'AUCTION'
  priceCents: number
  quantity: number
  status: string
  category?: string
  photoUrls?: string[]
  currentHighBidCents?: number | null
  endsAt?: string | null
  createdAt?: string
}

type FilterStatus = 'ALL' | 'LIVE' | 'PENDING_REVIEW' | 'SOLD' | 'ENDED'

export default function MarketplaceMyListingsPage() {
  const [filter, setFilter] = useState<FilterStatus>('ALL')

  const listingsQ = useQuery({
    queryKey: ['marketplace', 'listings', 'mine'],
    queryFn: () => api.get<Listing[]>('/marketplace/listings?mine=true'),
  })

  const rawListings = listingsQ.data ?? []

  const metrics = useMemo(() => {
    return {
      total: rawListings.length,
      live: rawListings.filter((l) => l.status === 'LIVE').length,
      pending: rawListings.filter((l) => l.status === 'PENDING_REVIEW').length,
      sold: rawListings.filter((l) => l.status === 'SOLD').length,
    }
  }, [rawListings])

  const filteredListings = useMemo(() => {
    if (filter === 'ALL') return rawListings
    return rawListings.filter((l) => l.status === filter)
  }, [rawListings, filter])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <MarketplaceNav
        title="My Listings"
        subtitle="Manage your surplus inventory listings, track live auction bidding, and review submitted lots."
        actions={
          <Link to="/admin/marketplace/create" className="btn-primary !text-sm !py-2 !px-4 inline-flex items-center gap-1.5">
            <span>➕</span>
            <span>List Inventory</span>
          </Link>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div
          className="p-4 rounded-xl border space-y-1"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3">Total Listings</span>
          <p className="text-2xl font-bold font-mono text-pleros-white">{metrics.total}</p>
        </div>
        <div
          className="p-4 rounded-xl border space-y-1"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3">Live on Market</span>
          <p className="text-2xl font-bold font-mono text-emerald-400">{metrics.live}</p>
        </div>
        <div
          className="p-4 rounded-xl border space-y-1"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3">In Review</span>
          <p className="text-2xl font-bold font-mono text-amber-400">{metrics.pending}</p>
        </div>
        <div
          className="p-4 rounded-xl border space-y-1"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3">Sold / Closed</span>
          <p className="text-2xl font-bold font-mono text-pleros-accent">{metrics.sold}</p>
        </div>
      </div>

      {/* Status Filter Chips */}
      <div className="flex flex-wrap items-center gap-2">
        {(['ALL', 'LIVE', 'PENDING_REVIEW', 'SOLD', 'ENDED'] as FilterStatus[]).map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setFilter(st)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              background: filter === st ? 'var(--c-primary-dim)' : 'var(--c-surface)',
              color: filter === st ? 'var(--c-primary)' : 'var(--c-text-2)',
              border: filter === st ? '1px solid var(--c-primary)' : '1px solid var(--c-border-card)',
            }}
          >
            {st === 'ALL' ? 'All Listings' : st.replace('_', ' ')}
            {st === 'ALL' && ` (${metrics.total})`}
            {st === 'LIVE' && ` (${metrics.live})`}
            {st === 'PENDING_REVIEW' && ` (${metrics.pending})`}
            {st === 'SOLD' && ` (${metrics.sold})`}
          </button>
        ))}
      </div>

      {/* Listings list */}
      {listingsQ.isLoading ? (
        <div
          className="p-12 text-center rounded-2xl border text-sm text-pleros-text-3 animate-pulse"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          Loading your listings…
        </div>
      ) : filteredListings.length === 0 ? (
        <EmptyState
          icon="📦"
          title={filter === 'ALL' ? 'No inventory listings found' : `No ${filter.toLowerCase().replace('_', ' ')} listings`}
          description={
            filter === 'ALL'
              ? 'List your surplus or aged inventory to connect with verified buyers across the distributor network.'
              : 'Try changing your status filter above or submit a new lot for review.'
          }
          action={
            <Link to="/admin/marketplace/create" className="btn-primary !text-sm mt-4 inline-block">
              List Your First Lot ↗
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredListings.map((l) => {
            const isAuction = l.listingType === 'AUCTION'
            const displayCents = isAuction && l.currentHighBidCents != null ? l.currentHighBidCents : l.priceCents
            const thumb = l.photoUrls?.[0]

            return (
              <div
                key={l.id}
                className="rounded-xl border overflow-hidden transition-all flex flex-col justify-between shadow-sm hover:shadow-md"
                style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
              >
                <div>
                  <div className="aspect-video w-full bg-black/30 relative overflow-hidden flex items-center justify-center">
                    {thumb ? (
                      <img src={thumb} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-pleros-text-3 text-xs gap-1">
                        <span className="text-3xl">📦</span>
                        <span>No image provided</span>
                      </div>
                    )}
                    <div className="absolute top-2 left-2">
                      <StatusBadge status={l.status} />
                    </div>
                    {isAuction && (
                      <span className="absolute top-2 right-2 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-pleros-accent text-pleros-white backdrop-blur">
                        Auction
                      </span>
                    )}
                  </div>

                  <div className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-pleros-white text-base line-clamp-1">{l.title}</h3>
                    </div>
                    {l.category && <p className="text-xs text-pleros-text-3">{l.category}</p>}

                    <div className="pt-2 border-t flex items-baseline justify-between" style={{ borderColor: 'var(--c-border)' }}>
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-pleros-text-3 block">
                          {isAuction ? 'Current High Bid' : 'List Price'}
                        </span>
                        <span className="text-base font-mono font-bold text-pleros-white">
                          ${(displayCents / 100).toFixed(2)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase tracking-wider text-pleros-text-3 block">
                          {isAuction ? 'Lots' : 'Available Qty'}
                        </span>
                        <span className="text-sm font-mono font-medium text-pleros-white">{l.quantity}</span>
                      </div>
                    </div>

                    {isAuction && l.endsAt && (
                      <div
                        className="p-2 rounded-lg text-xs flex items-center justify-between"
                        style={{ background: 'var(--c-surface-2)', color: 'var(--c-text-2)' }}
                      >
                        <span>Ends on:</span>
                        <span className="font-mono font-medium text-pleros-white">
                          {new Date(l.endsAt).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className="p-3 border-t flex items-center justify-between"
                  style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
                >
                  <span className="text-xs font-mono text-pleros-text-3">ID: …{l.id.slice(-6)}</span>
                  {l.status === 'LIVE' ? (
                    <Link
                      to={`/admin/marketplace/${l.id}`}
                      className="text-xs font-semibold text-pleros-accent hover:underline inline-flex items-center gap-1"
                    >
                      <span>View Live</span>
                      <span>↗</span>
                    </Link>
                  ) : (
                    <span className="text-xs text-pleros-text-3 italic">Not public</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
