import { Link, Outlet } from 'react-router-dom'

const TABS = [
  { href: '/m/warehouse', label: 'Warehouse' },
  { href: '/m/delivery', label: 'Delivery' },
  { href: '/m/sales', label: 'Sales' },
] as const

export function MobileLayout() {
  return (
    <div className="cosmos-mobile">
      <header className="cosmos-mobile-header">
        <Link to="/" className="cosmos-shop-link" style={{ fontSize: 13 }}>
          ← Hub
        </Link>
        <span style={{ fontWeight: 700, flex: 1, fontFamily: 'var(--font-display)' }}>Cosmos Mobile</span>
        <Link to="/admin/login" className="cosmos-shop-link" style={{ fontSize: 13 }}>
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
