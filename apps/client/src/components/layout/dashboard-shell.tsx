import { Link } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { CosmosLogo } from '@/components/cosmos-logo'
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
    document.body.classList.toggle('cosmos-nav-open', mobileNavOpen)
    return () => document.body.classList.remove('cosmos-nav-open')
  }, [mobileNavOpen])

  return (
    <div className="cosmos-admin-shell">
      {mobileNavOpen ? (
        <button
          type="button"
          className="cosmos-sidebar-backdrop"
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

      <div className="cosmos-admin-main">
        <header className="cosmos-admin-header">
          <div className="cosmos-admin-header-start">
            <button
              type="button"
              className="cosmos-mobile-menu-btn"
              aria-label="Open navigation menu"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <Link to="/admin" className="cosmos-admin-header-logo" title="Cosmos">
              <CosmosLogo variant="mark" size="sm" />
            </Link>
            <div className="cosmos-admin-header-titles">
              <p className="cosmos-admin-header-label">Cosmos Admin</p>
              <h1 className="cosmos-admin-header-title">{titleFromPath(pathname)}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <GlobalSearch />
            <ThemeSwitcher compact className="hidden sm:flex" />
            <Link to="/admin/notifications" className="cosmos-icon-btn" title="Alerts" aria-label="Notifications">
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
        <main className="cosmos-admin-content">{children}</main>
      </div>
      {!pathname.startsWith('/admin/celestial') ? <CelestialChat surface="admin" variant="floating" /> : null}
    </div>
  )
}
