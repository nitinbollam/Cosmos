import { Link } from 'react-router-dom'
import { useMarketplaceAccess } from '@/pages/marketplace/use-marketplace-access'
import { useSessionGate } from './use-session-gate'

/**
 * The marketplace storefront: buying from other distributors. Needs a signed-in session whose
 * account has marketplace access; customer (portal buyer) accounts don't, so they get an
 * explanation instead of a page of errors.
 */
export function RequireMarketplaceShop({ children }: { children: React.ReactNode }) {
  const ready = useSessionGate({ surface: 'shop', loginPath: '/login' })
  const { loading, failed, canBrowse } = useMarketplaceAccess()

  if (!ready || loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-pleros-text-3 text-sm">
        Checking session…
      </div>
    )
  }

  // "No access" only when we know it; if the check failed, the page shows the server's answer.
  if (!canBrowse && !failed) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="pleros-card space-y-3">
          <h1 className="text-lg font-semibold text-pleros-white">Marketplace not available</h1>
          <p className="text-sm text-pleros-text-3">
            The marketplace is where distributors trade surplus with each other. Your account doesn&apos;t have
            access to it.
          </p>
          <Link to="/catalog" className="btn-primary !text-sm inline-block">
            Back to the catalog
          </Link>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
