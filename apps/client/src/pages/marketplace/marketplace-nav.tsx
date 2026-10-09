import { Link, useLocation } from 'react-router-dom'

export type MarketplaceTab = {
  id: string
  label: string
  icon: string
  to: string
  adminOnly?: boolean
}

export function MarketplaceNav({
  title = 'Marketplace',
  subtitle = 'B2B Wholesale Surplus, Liquidation Lots & Verified Distributor Network',
  actions,
}: {
  title?: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  const location = useLocation()
  const isAdmin = location.pathname.startsWith('/admin')
  const basePath = isAdmin ? '/admin/marketplace' : '/marketplace'

  const tabs: MarketplaceTab[] = [
    { id: 'browse', label: 'Browse', icon: '🏪', to: basePath },
    ...(isAdmin
      ? [
          { id: 'create', label: 'List Inventory', icon: '➕', to: '/admin/marketplace/create', adminOnly: true },
          { id: 'my-listings', label: 'My Listings', icon: '📦', to: '/admin/marketplace/my-listings', adminOnly: true },
        ]
      : []),
    { id: 'orders', label: 'Orders', icon: '🛒', to: `${basePath}/orders` },
    { id: 'payment-methods', label: 'Payment Methods', icon: '💳', to: `${basePath}/payment-methods` },
    ...(isAdmin
      ? [
          { id: 'alerts', label: 'Alerts', icon: '🔔', to: '/admin/marketplace/alerts', adminOnly: true },
          { id: 'analytics', label: 'Analytics', icon: '📊', to: '/admin/marketplace/analytics', adminOnly: true },
        ]
      : []),
  ]

  const isTabActive = (tab: MarketplaceTab) => {
    if (tab.id === 'browse') {
      return location.pathname === basePath
    }
    return location.pathname.startsWith(tab.to)
  }

  return (
    <div className="space-y-4">
      {/* Header section with title and optional top actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border"
              style={{
                borderColor: 'var(--c-border-card)',
                background: 'var(--c-surface-2)',
                color: 'var(--c-accent)',
              }}
            >
              {isAdmin ? 'Distributor Network' : 'Buyer Portal'}
            </span>
            <span className="text-xs text-pleros-text-3">Verified B2B Exchange</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-pleros-white tracking-tight">
            {title}
          </h1>
          <p className="text-sm text-pleros-text-3 mt-0.5">{subtitle}</p>
        </div>

        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Tab bar */}
      <div
        className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl border w-full sm:w-fit overflow-x-auto"
        style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
      >
        {tabs.map((tab) => {
          const active = isTabActive(tab)
          return (
            <Link
              key={tab.id}
              to={tab.to}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all shrink-0"
              style={{
                background: active ? 'var(--c-primary-dim)' : 'transparent',
                color: active ? 'var(--c-primary)' : 'var(--c-text-2)',
                border: active ? '1px solid var(--c-primary)' : '1px solid transparent',
              }}
            >
              <span className="text-base leading-none">{tab.icon}</span>
              <span>{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
