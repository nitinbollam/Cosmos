import { Link, Outlet, useLocation } from 'react-router-dom'
import { RequireMobileAuth } from '@/components/auth/require-mobile-auth'

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
  return (
    <div className="cosmos-mobile">
      <header className="cosmos-mobile-header">
        <Link to="/" className="cosmos-shop-link" style={{ fontSize: 13 }}>
          ← Hub
        </Link>
        <span style={{ fontWeight: 700, flex: 1, fontFamily: 'var(--font-display)' }}>Cosmos Mobile</span>
        <Link to="/m/login" className="cosmos-shop-link" style={{ fontSize: 13 }}>
          Sign in
        </Link>
      </header>
      <nav className="cosmos-mobile-nav">
        {TABS.map((t) => (
          <Link key={t.href} to={t.href} className="cosmos-mobile-tab">
            {t.label}
          </Link>
        ))}
      </nav>
      <main style={{ padding: 16 }}>
        <Outlet />
      </main>
    </div>
  )
}
