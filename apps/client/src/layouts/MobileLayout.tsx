import { Link, Outlet, useLocation } from 'react-router-dom'
import { CosmosLogo } from '@/components/cosmos-logo'
import { RequireMobileAuth } from '@/components/auth/require-mobile-auth'
import { OfflineSyncRunner } from '@/components/mobile/offline-sync-runner'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { signOut } from '@/lib/auth-session'

const TABS = [
  { href: '/m/warehouse', label: 'Warehouse' },
  { href: '/m/delivery', label: 'Delivery' },
  { href: '/m/sales', label: 'Sales' },
] as const

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

  return (
    <div className="cosmos-mobile">
      <header className="cosmos-mobile-header">
        <Link to="/" className="cosmos-mobile-back">
          ← Hub
        </Link>
        <Link to="/m/warehouse" className="cosmos-mobile-brand" title="Cosmos Mobile">
          <CosmosLogo variant="mark" size="sm" />
          <span>Mobile</span>
        </Link>
        <div className="cosmos-mobile-header-actions">
          <ThemeSwitcher compact />
          <button
            type="button"
            className="cosmos-mobile-back cosmos-mobile-signout"
            onClick={() => void signOut({ redirectTo: '/m/login' })}
          >
            Sign out
          </button>
        </div>
      </header>
      <nav className="cosmos-mobile-nav">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`)
          return (
            <Link
              key={t.href}
              to={t.href}
              className={`cosmos-mobile-tab${active ? ' cosmos-mobile-tab--active' : ''}`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      <main className="cosmos-mobile-main">
        <OfflineSyncRunner />
        <Outlet />
      </main>
    </div>
  )
}
