import { Link } from 'react-router-dom'
import { useMarketplaceAccess } from './use-marketplace-access'

/**
 * Wraps the listing-management pages (create, my listings). Only administrators manage listings
 * and their inventory; anyone else who opens these URLs gets an explanation, not a form the
 * server would refuse.
 */
export function ListingAdminGate({ children }: { children: React.ReactNode }) {
  const { loading, failed, canManageListings } = useMarketplaceAccess()
  if (loading) {
    return <div className="p-8 text-center text-sm text-pleros-text-3">Checking access…</div>
  }
  // "Administrators only" only when we know it; if the check failed, the server still refuses.
  if (!canManageListings && !failed) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="pleros-card space-y-3">
          <h1 className="text-lg font-semibold text-pleros-white">Administrators only</h1>
          <p className="text-sm text-pleros-text-3">
            Listing inventory on the marketplace reserves stock, so only administrators can create or manage
            listings. You can still browse and buy.
          </p>
          <Link to="/admin/marketplace" className="btn-primary !text-sm inline-block">
            Browse the marketplace
          </Link>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
