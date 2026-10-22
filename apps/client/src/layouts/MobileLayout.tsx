import { Link, Outlet, useLocation } from 'react-router-dom'
import { PlerosLogo } from '@/components/pleros-logo'
import { RequireMobileAuth } from '@/components/auth/require-mobile-auth'
import { OfflineSyncRunner } from '@/components/mobile/offline-sync-runner'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { getSessionUser, signOut } from '@/lib/auth-session'
import { homeFor, tabsFor } from '@/lib/mobile-home'

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
  const visibleTabs = tabsFor(user?.role, user?.permissions ?? [])
  const primaryHref = homeFor(user?.role)

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
