import { Link } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { PlerosLogo } from '@/components/pleros-logo'
import { CelestialChat } from '@/components/celestial/celestial-chat'
import { Sidebar } from '@/components/layout/sidebar'
import { GlobalSearch } from '@/components/global-search'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { UserMenu } from '@/components/user-menu'

function titleFromPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  const seg = parts[0] === 'admin' ? (parts[1] ?? '') : (parts[0] ?? '')
  if (!seg || seg === 'admin') return 'Overview'
  if (seg === 'celestial') return 'Celestial'
  return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ')
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const pathname = useLocation().pathname ?? '/'

  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

  useEffect(() => {
    document.body.classList.toggle('pleros-nav-open', mobileNavOpen)
    return () => document.body.classList.remove('pleros-nav-open')
  }, [mobileNavOpen])

  return (
    <div className="pleros-admin-shell">
      {mobileNavOpen ? (
        <button
          type="button"
          className="pleros-sidebar-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <div className="pleros-admin-main">
        <header className="pleros-admin-header">
          <div className="pleros-admin-header-start">
            <button
              type="button"
              className="pleros-mobile-menu-btn"
              aria-label="Open navigation menu"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <Link to="/admin" className="pleros-admin-header-logo" title="Pleros">
              <PlerosLogo variant="mark" size="sm" />
            </Link>
            <div className="pleros-admin-header-titles">
              <p className="pleros-admin-header-label">Pleros Admin</p>
              <h1 className="pleros-admin-header-title">{titleFromPath(pathname)}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <GlobalSearch />
            <ThemeSwitcher compact className="hidden sm:flex" />
            <Link to="/admin/notifications" className="pleros-icon-btn" title="Alerts" aria-label="Notifications">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 3a5 5 0 0 0-5 5v3.5L5 14.5V16h14v-1.5l-2-3V8a5 5 0 0 0-5-5Z"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </Link>
            <UserMenu afterLogout="/admin/login" />
          </div>
        </header>
        <main className="pleros-admin-content">{children}</main>
      </div>
      {!pathname.startsWith('/admin/celestial') && !pathname.startsWith('/admin/pos') ? (
        <CelestialChat surface="admin" variant="floating" />
      ) : null}
    </div>
  )
}
