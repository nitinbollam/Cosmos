import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'

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
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-pleros-white font-display text-2xl">Marketplace</h1>
          <p className="text-sm text-pleros-text-3 mt-1">Browse inventory from other Pleros distributors</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/marketplace/create" className="btn-primary text-sm">
            List inventory
          </Link>
          <Link to="/admin/marketplace/my-listings" className="neo-btn-secondary text-sm inline-block px-3 py-2 rounded">
            My listings
          </Link>
          <Link to="/admin/marketplace/orders" className="neo-btn-secondary text-sm inline-block px-3 py-2 rounded">
            My orders
          </Link>
          <Link to="/admin/marketplace/payment-methods" className="neo-btn-secondary text-sm inline-block px-3 py-2 rounded">
            Payment methods
          </Link>
          <Link to="/admin/marketplace/alerts" className="neo-btn-secondary text-sm inline-block px-3 py-2 rounded">
            Alerts
          </Link>
          <Link to="/admin/marketplace/analytics" className="neo-btn-secondary text-sm inline-block px-3 py-2 rounded">
            Analytics
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="pleros-input min-w-[200px]"
          placeholder="Search listings…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="pleros-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {(catsQ.data ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-primary text-sm"
          onClick={() => setApplied({ search: search.trim(), category })}
        >
          Apply
        </button>
      </div>

      {listingsQ.isLoading && <p className="text-pleros-text-3 text-sm">Loading listings…</p>}
      {listingsQ.isError && <p className="text-red-400 text-sm">Could not load marketplace listings.</p>}

      {!listingsQ.isLoading && (listingsQ.data?.length ?? 0) === 0 && (
        <EmptyState icon="🏪" title="No live listings" description="Check back soon or list your own inventory." />
      )}

      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(listingsQ.data ?? []).map((l: Listing) => {
          const isAuction = l.listingType === 'AUCTION'
          const displayCents = isAuction && l.currentHighBidCents != null ? l.currentHighBidCents : l.priceCents
          const endsLabel = isAuction ? formatEndsAt(l.endsAt) : null
          const thumb = l.photoUrls?.[0]
          return (
            <li
              key={l.id}
              className="border rounded-lg p-4"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
            >
              <Link to={`/admin/marketplace/${l.id}`} className="block hover:opacity-90">
                {thumb && (
                  <img src={thumb} alt="" className="w-full h-32 object-cover rounded mb-3 bg-black/20" />
                )}
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-pleros-white">{l.title}</p>
                  {isAuction && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-pleros-accent/20 text-pleros-accent shrink-0">
                      Auction
                    </span>
                  )}
                </div>
                <p className="text-xs text-pleros-text-3 mt-1">{l.category}</p>
                <p className="text-sm mt-2">
                  {isAuction ? (
                    <>
                      {l.currentHighBidCents != null ? 'High bid' : 'Starting'} ${(displayCents / 100).toFixed(2)}
                      {endsLabel && <span className="text-pleros-text-3"> · {endsLabel}</span>}
                    </>
                  ) : (
                    <>
                      ${(displayCents / 100).toFixed(2)} · qty {l.quantity}
                    </>
                  )}
                </p>
                <p className="text-xs text-pleros-text-3 mt-2">
                  {l.seller.handle} · ★ {l.seller.ratingAvg.toFixed(1)} · {l.seller.completedOrderCount} orders
                  {l.seller.avgResponseTimeHours > 0 && ` · ~${l.seller.avgResponseTimeHours.toFixed(0)}h response`}
                </p>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
