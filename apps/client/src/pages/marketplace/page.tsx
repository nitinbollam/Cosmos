import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'
import { MarketplaceNav } from './marketplace-nav'

type Listing = {
  id: string
  title: string
  listingType: 'FIXED' | 'AUCTION'
  priceCents: number
  quantity: number
  category: string
  status: string
  photoUrls?: string[]
  seller: { handle: string; ratingAvg: number; completedOrderCount: number; avgResponseTimeHours: number }
  currentHighBidCents?: number | null
  endsAt?: string | null
}

function formatEndsAt(endsAt: string | null | undefined): string | null {
  if (!endsAt) return null
  const ms = new Date(endsAt).getTime() - Date.now()
  if (ms <= 0) return 'Ended'
  const hours = Math.floor(ms / 3600000)
  if (hours >= 48) return `${Math.ceil(hours / 24)}d left`
  if (hours >= 1) return `${hours}h left`
  return `${Math.ceil(ms / 60000)}m left`
}

export default function MarketplaceBrowsePage() {
  const location = useLocation()
  const isAdmin = location.pathname.startsWith('/admin')
  const basePath = isAdmin ? '/admin/marketplace' : '/marketplace'

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'FIXED' | 'AUCTION'>('ALL')
  const [applied, setApplied] = useState({ search: '', category: '' })

  const catsQ = useQuery({
    queryKey: ['marketplace', 'categories'],
    queryFn: () => api.get<string[]>('/marketplace/categories'),
  })

  const listingsQ = useQuery({
    queryKey: ['marketplace', 'listings', applied],
    queryFn: () => {
      const params = new URLSearchParams()
      if (applied.search) params.set('search', applied.search)
      if (applied.category) params.set('category', applied.category)
      const q = params.toString()
      return api.get<Listing[]>(`/marketplace/listings${q ? `?${q}` : ''}`)
    },
  })

  const rawListings = listingsQ.data ?? []
  const filteredListings = rawListings.filter((l) => {
    if (typeFilter === 'FIXED') return l.listingType === 'FIXED'
    if (typeFilter === 'AUCTION') return l.listingType === 'AUCTION'
    return true
  })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <MarketplaceNav
        title="Marketplace"
        subtitle="Browse wholesale inventory, surplus lots, and live auctions from verified Pleros distributors."
        actions={
          isAdmin ? (
            <Link
              to="/admin/marketplace/create"
              className="btn-primary !text-sm !py-2 !px-4 inline-flex items-center gap-1.5"
            >
              <span>➕</span>
              <span>List Inventory</span>
            </Link>
          ) : undefined
        }
      />

      {/* Filter and Search Bar */}
      <div
        className="p-4 rounded-2xl border shadow-sm space-y-3"
        style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-pleros-text-3">
              🔍
            </span>
            <input
              className="pleros-input w-full !pl-9 !py-2.5 !text-sm"
              placeholder="Search wholesale lots, SKU codes, descriptions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setApplied({ search: search.trim(), category })
              }}
            />
          </div>

          <select
            className="pleros-input !py-2.5 !text-sm min-w-[170px]"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              setApplied({ search: search.trim(), category: e.target.value })
            }}
          >
            <option value="">All Categories</option>
            {(catsQ.data ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <div
            className="flex items-center p-1 rounded-xl border gap-1"
            style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
          >
            {(['ALL', 'FIXED', 'AUCTION'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: typeFilter === t ? 'var(--c-primary-dim)' : 'transparent',
                  color: typeFilter === t ? 'var(--c-primary)' : 'var(--c-text-3)',
                }}
              >
                {t === 'ALL' ? 'All Formats' : t === 'FIXED' ? 'Fixed Price' : 'Auctions'}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn-primary !py-2.5 !px-5 !text-sm font-semibold"
            onClick={() => setApplied({ search: search.trim(), category })}
          >
            Filter Lots
          </button>

          {(applied.search || applied.category) && (
            <button
              type="button"
              className="btn-ghost !text-xs !py-2"
              onClick={() => {
                setSearch('')
                setCategory('')
                setApplied({ search: '', category: '' })
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {listingsQ.isLoading && (
        <div
          className="p-12 text-center rounded-2xl border text-sm text-pleros-text-3 animate-pulse"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          Loading marketplace listings…
        </div>
      )}

      {listingsQ.isError && (
        <div className="p-4 rounded-xl border border-red-800 bg-red-950/30 text-sm text-red-400">
          Could not load marketplace listings. Please verify network access.
        </div>
      )}

      {!listingsQ.isLoading && filteredListings.length === 0 && (
        <EmptyState
          icon="🏪"
          title="No live inventory found"
          description="Check back soon for new surplus releases or list your own inventory to start trading."
          action={
            isAdmin ? (
              <Link to="/admin/marketplace/create" className="btn-primary !text-sm mt-4 inline-block">
                List Inventory ↗
              </Link>
            ) : undefined
          }
        />
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredListings.map((l: Listing) => {
          const isAuction = l.listingType === 'AUCTION'
          const displayCents = isAuction && l.currentHighBidCents != null ? l.currentHighBidCents : l.priceCents
          const endsLabel = isAuction ? formatEndsAt(l.endsAt) : null
          const thumb = l.photoUrls?.[0]

          return (
            <div
              key={l.id}
              className="rounded-2xl border overflow-hidden transition-all flex flex-col justify-between shadow-sm hover:shadow-lg hover:border-pleros-border-hover group"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
            >
              <Link to={`${basePath}/${l.id}`} className="block">
                <div className="aspect-video w-full bg-black/40 relative overflow-hidden flex items-center justify-center">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-pleros-text-3 text-xs gap-1">
                      <span className="text-3xl">📦</span>
                      <span>Verified Surplus Lot</span>
                    </div>
                  )}

                  {isAuction ? (
                    <span className="absolute top-2.5 right-2.5 text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full bg-pleros-accent text-pleros-white backdrop-blur shadow-md">
                      🔨 Auction
                    </span>
                  ) : (
                    <span className="absolute top-2.5 right-2.5 text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full bg-zinc-900/80 text-zinc-300 backdrop-blur border border-white/10">
                      🏷️ Fixed Price
                    </span>
                  )}
                </div>

                <div className="p-5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-pleros-white text-base line-clamp-1 group-hover:text-pleros-accent transition-colors">
                      {l.title}
                    </h3>
                  </div>

                  <span
                    className="inline-block text-[11px] font-medium px-2 py-0.5 rounded"
                    style={{ background: 'var(--c-surface-2)', color: 'var(--c-text-2)' }}
                  >
                    {l.category}
                  </span>

                  <div className="pt-3 border-t flex items-baseline justify-between" style={{ borderColor: 'var(--c-border)' }}>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-pleros-text-3 block">
                        {isAuction ? (l.currentHighBidCents != null ? 'High Bid' : 'Starting Bid') : 'Wholesale Price'}
                      </span>
                      <span className="text-lg font-mono font-bold text-pleros-white">
                        ${(displayCents / 100).toFixed(2)}
                      </span>
                    </div>

                    <div className="text-right">
                      {isAuction ? (
                        endsLabel && (
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded-full"
                            style={{ background: 'var(--c-surface-2)', color: 'var(--c-accent)' }}
                          >
                            ⏱️ {endsLabel}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-pleros-text-3 font-mono">
                          Available: <strong className="text-pleros-white">{l.quantity}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>

              <div
                className="p-3.5 border-t text-xs flex items-center justify-between"
                style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
              >
                <div className="flex items-center gap-1.5 text-pleros-text-3 truncate max-w-[70%]">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="truncate font-medium text-pleros-text-2">{l.seller.handle}</span>
                  <span>· ★ {l.seller.ratingAvg.toFixed(1)}</span>
                </div>
                <Link
                  to={`${basePath}/${l.id}`}
                  className="text-xs font-semibold text-pleros-accent hover:underline shrink-0"
                >
                  View Details →
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
