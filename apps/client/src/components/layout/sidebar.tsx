import { PlerosLogo } from '@/components/pleros-logo'
import { Link } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { SidebarIcon, type SidebarIconName } from '@/components/layout/sidebar-icons'

type NavItem = {
  href: string
  label: string
  icon: SidebarIconName
  feature?: 'celestial' | 'marketplace'
  permission?: string
}

const BASE_SIDEBAR_NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { href: '/admin/inventory', label: 'Inventory', icon: 'inventory', permission: 'inventory.read' },
  { href: '/admin/orders', label: 'Orders', icon: 'orders', permission: 'orders.read' },
  { href: '/admin/fulfillment', label: 'Fulfillment', icon: 'fulfillment', permission: 'wms.read' },
  { href: '/admin/warehouse', label: 'Warehouse', icon: 'warehouse', permission: 'wms.read' },
  { href: '/admin/purchasing', label: 'Purchasing', icon: 'purchasing', permission: 'purchasing.read' },
  { href: '/admin/marketplace', label: 'Marketplace', icon: 'inventory', permission: 'marketplace.read', feature: 'marketplace' },
  { href: '/admin/compliance', label: 'Compliance', icon: 'compliance', permission: 'compliance.read' },
  { href: '/admin/crm', label: 'CRM', icon: 'crm', permission: 'crm.read' },
  { href: '/admin/quotes', label: 'Quotes', icon: 'orders', permission: 'quotes.read' },
  { href: '/admin/dispatch', label: 'Dispatch', icon: 'dispatch', permission: 'dispatch.read' },
  { href: '/admin/finance', label: 'Finance', icon: 'finance', permission: 'finance.read' },
  { href: '/admin/reports', label: 'Reports', icon: 'reports', permission: 'reports.read' },
  { href: '/admin/pos', label: 'POS', icon: 'orders', permission: 'pos.read' },
  { href: '/admin/notifications', label: 'Notifications', icon: 'notifications', permission: 'notifications.read' },
  { href: '/admin/celestial', label: 'Celestial', icon: 'celestial', feature: 'celestial', permission: 'celestial.chat' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings', permission: 'settings.read' },
]

function hasClientPermission(perms: string[] | undefined, role: string | undefined, required?: string): boolean {
  if (!required) return true
  if (role === 'SUPER_ADMIN' || role === 'TENANT_ADMIN') return true
  if (!perms || !Array.isArray(perms)) return false
  if (perms.includes('*')) return true
  if (perms.includes(required)) return true
  const [mod] = required.split('.')
  if (perms.includes(`${mod}.*`)) return true
  return false
}

/** @deprecated use BASE_SIDEBAR_NAV filtered in Sidebar */
export const SIDEBAR_NAV = BASE_SIDEBAR_NAV

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

  const { data: me } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get<{ role?: string; permissions?: string[] }>('/auth/me'),
  })

  const { data: features } = useQuery({
    queryKey: ['tenant-features'],
    queryFn: () => api.get<{ effective?: { celestial?: boolean; marketplace?: boolean } }>('/features'),
  })

  const navItems = BASE_SIDEBAR_NAV.filter((item) => {
    if (item.feature === 'celestial' && features?.effective?.celestial === false) return false
    if (item.feature === 'marketplace' && features?.effective?.marketplace !== true) return false
    if (!hasClientPermission(me?.permissions, me?.role, item.permission)) return false
    return true
  })

  return (
    <aside
      className={[
        'pleros-sidebar',
        collapsed && !mobileOpen ? 'pleros-sidebar--collapsed' : '',
        mobileOpen ? 'pleros-sidebar--mobile-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="pleros-sidebar-brand">
        <Link
          to="/admin"
          className="pleros-sidebar-brand-link"
          title="Pleros"
          onClick={() => onMobileClose?.()}
        >
          {showLabels ? <PlerosLogo size="md" /> : <PlerosLogo variant="mark" size="sm" />}
        </Link>
        {mobileOpen ? (
          <button
            type="button"
            className="pleros-sidebar-close"
            aria-label="Close navigation menu"
            onClick={() => onMobileClose?.()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>

      <nav className="pleros-sidebar-nav" aria-label="Admin navigation">
        {navItems.map((item) => {
          const active =
            item.href === '/admin'
              ? pathname === '/admin' || pathname === '/admin/'
              : pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              to={item.href}
              title={item.label}
              className={`pleros-nav-link${active ? ' pleros-nav-link--active' : ''}`}
              onClick={() => onMobileClose?.()}
            >
              <span className="pleros-nav-icon-wrap">
                <SidebarIcon name={item.icon} />
              </span>
              {showLabels && <span className="pleros-nav-label">{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="pleros-sidebar-foot">
        {showLabels && (
          <Link to="/catalog" className="pleros-sidebar-shop" onClick={() => onMobileClose?.()}>
            B2B storefront
          </Link>
        )}
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
          className="pleros-sidebar-toggle pleros-sidebar-toggle--desktop"
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
