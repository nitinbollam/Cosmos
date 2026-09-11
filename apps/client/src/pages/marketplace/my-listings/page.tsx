import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'

type Listing = {
  id: string
  title: string
  listingType: 'FIXED' | 'AUCTION'
  priceCents: number
  quantity: number
  status: string
  endsAt?: string | null
}

export default function MarketplaceMyListingsPage() {
  const listingsQ = useQuery({
    queryKey: ['marketplace', 'listings', 'mine'],
    queryFn: () => api.get<Listing[]>('/marketplace/listings?mine=true'),
  })

  return (
    <div>
      <Link to="/admin/marketplace" className="text-sm text-pleros-accent">
        ← Marketplace
      </Link>
      <h1 className="text-2xl font-display text-pleros-white mt-2">My listings</h1>
      {listingsQ.isLoading && <p className="text-sm text-pleros-text-3 mt-4">Loading…</p>}
      {!listingsQ.isLoading && (listingsQ.data?.length ?? 0) === 0 && (
        <EmptyState title="No listings yet" description="List inventory to sell on the marketplace." />
      )}
      <ul className="grid gap-3 mt-4">
        {(listingsQ.data ?? []).map((l) => (
          <li
            key={l.id}
            className="border rounded-lg p-4 flex justify-between gap-3"
            style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
          >
            <div>
              <p className="font-medium text-pleros-white">{l.title}</p>
              <p className="text-xs text-pleros-text-3 mt-1">
                {l.listingType} · {l.status} · ${(l.priceCents / 100).toFixed(2)}
                {l.listingType === 'AUCTION' && l.endsAt && ` · ends ${new Date(l.endsAt).toLocaleDateString()}`}
              </p>
            </div>
            {l.status === 'LIVE' && (
              <Link to={`/admin/marketplace/${l.id}`} className="text-sm text-pleros-accent">
                View
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
