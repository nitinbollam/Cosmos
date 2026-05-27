import { CosmosLogo } from '@/components/cosmos-logo'
import { Link } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { SidebarIcon, type SidebarIconName } from '@/components/layout/sidebar-icons'

export const SIDEBAR_NAV: { href: string; label: string; icon: SidebarIconName }[] = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { href: '/admin/inventory', label: 'Inventory', icon: 'inventory' },
  { href: '/admin/orders', label: 'Orders', icon: 'orders' },
  { href: '/admin/fulfillment', label: 'Fulfillment', icon: 'fulfillment' },
  { href: '/admin/warehouse', label: 'Warehouse', icon: 'warehouse' },
  { href: '/admin/purchasing', label: 'Purchasing', icon: 'purchasing' },
  { href: '/admin/compliance', label: 'Compliance', icon: 'compliance' },
  { href: '/admin/crm', label: 'CRM', icon: 'crm' },
  { href: '/admin/dispatch', label: 'Dispatch', icon: 'dispatch' },
  { href: '/admin/finance', label: 'Finance', icon: 'finance' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' },
]

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen = false,
  onMobileClose,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
  mobileOpen?: boolean
  onMobileClose?: () => void
}) {
  const pathname = useLocation().pathname ?? '/admin'
  const showLabels = mobileOpen || !collapsed

  return (
    <aside
      className={[
        'cosmos-sidebar',
        collapsed && !mobileOpen ? 'cosmos-sidebar--collapsed' : '',
        mobileOpen ? 'cosmos-sidebar--mobile-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="cosmos-sidebar-brand">
        <Link
          to="/admin"
          className="cosmos-sidebar-brand-link"
          title="Cosmos"
          onClick={() => onMobileClose?.()}
        >
          {showLabels ? <CosmosLogo size="md" /> : <CosmosLogo variant="mark" size="sm" />}
        </Link>
        {mobileOpen ? (
          <button
            type="button"
            className="cosmos-sidebar-close"
            aria-label="Close navigation menu"
            onClick={() => onMobileClose?.()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>

      <nav className="cosmos-sidebar-nav" aria-label="Admin navigation">
        {SIDEBAR_NAV.map((item) => {
          const active =
            item.href === '/admin'
              ? pathname === '/admin' || pathname === '/admin/'
              : pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              to={item.href}
              title={item.label}
              className={`cosmos-nav-link${active ? ' cosmos-nav-link--active' : ''}`}
              onClick={() => onMobileClose?.()}
            >
              <span className="cosmos-nav-icon-wrap">
                <SidebarIcon name={item.icon} />
              </span>
              {showLabels && <span className="cosmos-nav-label">{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="cosmos-sidebar-foot">
        {showLabels && (
          <Link to="/catalog" className="cosmos-sidebar-shop" onClick={() => onMobileClose?.()}>
            B2B storefront
          </Link>
        )}
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
          className="cosmos-sidebar-toggle cosmos-sidebar-toggle--desktop"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            {collapsed ? (
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
