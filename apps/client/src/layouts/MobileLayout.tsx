import { Link, Outlet, useLocation } from 'react-router-dom'
import { PlerosLogo } from '@/components/pleros-logo'
import { RequireMobileAuth } from '@/components/auth/require-mobile-auth'
import { OfflineSyncRunner } from '@/components/mobile/offline-sync-runner'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { getSessionUser, signOut } from '@/lib/auth-session'

type MobileTab = {
  href: string
  label: string
  permission?: string
  roles?: string[]
}

const ALL_TABS: MobileTab[] = [
  {
    href: '/m/warehouse',
    label: 'Warehouse',
    permission: 'wms.read',
    roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'WAREHOUSE_STAFF', 'OPS_STAFF'],
  },
  {
    href: '/m/delivery',
    label: 'Delivery',
    permission: 'dispatch.read',
    roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'DRIVER', 'OPS_STAFF'],
  },
  {
    href: '/m/sales',
    label: 'Sales',
    permission: 'crm.read',
    roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'SALES_REP', 'OPS_STAFF'],
  },
]

function isTabAllowed(tab: MobileTab, user: ReturnType<typeof getSessionUser>): boolean {
  if (!user) return true
  const role = user.role?.toUpperCase() || ''
  if (role === 'SUPER_ADMIN' || role === 'TENANT_ADMIN') return true
  if (user.permissions?.includes('*') || (tab.permission && user.permissions?.includes(tab.permission))) {
    return true
  }
  if (tab.roles && tab.roles.includes(role)) {
    return true
  }
  return false
}

export function MobileLayout() {
  const { pathname } = useLocation()

  if (pathname === '/m/login' || pathname.startsWith('/m/login/')) {
    return <Outlet />
  }

  return (
    <RequireMobileAuth>
      <MobileShell />
    </RequireMobileAuth>
  )
}

function MobileShell() {
  const { pathname } = useLocation()
  const user = getSessionUser()
  const allowedTabs = ALL_TABS.filter((t) => isTabAllowed(t, user))
  const visibleTabs = allowedTabs.length > 0 ? allowedTabs : ALL_TABS
  const primaryHref = visibleTabs[0]?.href ?? '/m/warehouse'

  return (
    <div className="pleros-mobile">
      <header className="pleros-mobile-header">
        <Link to="/" className="pleros-mobile-back">
          ← Hub
        </Link>
        <Link to={primaryHref} className="pleros-mobile-brand" title="Pleros Mobile">
          <PlerosLogo variant="mark" size="sm" />
          <span>Mobile</span>
        </Link>
        <div className="pleros-mobile-header-actions">
          <ThemeSwitcher compact />
          <button
            type="button"
            className="pleros-mobile-back pleros-mobile-signout"
            onClick={() => void signOut({ redirectTo: '/m/login' })}
          >
            Sign out
          </button>
        </div>
      </header>
      <nav className="pleros-mobile-nav">
        {visibleTabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`)
          return (
            <Link
              key={t.href}
              to={t.href}
              className={`pleros-mobile-tab${active ? ' pleros-mobile-tab--active' : ''}`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      <main className="pleros-mobile-main">
        <OfflineSyncRunner />
        <Outlet />
      </main>
    </div>
  )
}
