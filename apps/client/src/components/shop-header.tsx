import { PlerosLogo } from '@/components/pleros-logo'
import { Link, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { useCartStore } from '@/stores/cart.store'
import { STOREFRONT_AUTH_EVENT } from '@/lib/auth-events'
import { jwtEmail } from '@/lib/jwt'
import { signOut } from '@/lib/auth-session'
import { ThemeSwitcher } from '@/components/theme-switcher'

export function ShopHeader() {
  const location = useLocation()
  const count = useCartStore((s) => s.count())
  const [tenantLabel, setTenantLabel] = useState('Your business')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const refreshAuth = useCallback(() => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('pleros.accessToken') : null
    setUserEmail(jwtEmail(token))
    const tid = typeof window !== 'undefined' ? window.sessionStorage.getItem('pleros.tenantId') : null
    if (tid) setTenantLabel(tid.slice(0, 8))
  }, [])

  useEffect(() => {
    refreshAuth()
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'pleros.accessToken' || e.key === null) refreshAuth()
    }
    const onAuthEvt = () => refreshAuth()
    window.addEventListener('storage', onStorage)
    window.addEventListener(STOREFRONT_AUTH_EVENT, onAuthEvt)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(STOREFRONT_AUTH_EVENT, onAuthEvt)
    }
  }, [refreshAuth])

  useEffect(() => {
    document.body.classList.toggle('pleros-shop-menu-open', navOpen)
    return () => document.body.classList.remove('pleros-shop-menu-open')
  }, [navOpen])

  function navClass(path: string) {
    const active = location.pathname === path || location.pathname.startsWith(`${path}/`)
    return `pleros-shop-link${active ? ' pleros-shop-link--active' : ''}`
  }

  return (
    <header className="pleros-shop-header">
      <div className="pleros-shop-header-row">
        <button
          type="button"
          className="pleros-shop-menu-btn"
          aria-label={navOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((o) => !o)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            {navOpen ? (
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
        </button>
        <Link to="/catalog" className="pleros-shop-brand">
          <PlerosLogo variant="mark" size="sm" />
          <span className="pleros-shop-brand-label">{tenantLabel}</span>
        </Link>
        <nav className={`pleros-shop-nav${navOpen ? ' pleros-shop-nav--open' : ''}`}>
          <Link to="/catalog" className={navClass('/catalog')} onClick={() => setNavOpen(false)}>
            Catalog
          </Link>
          <Link to="/marketplace" className={navClass('/marketplace')} onClick={() => setNavOpen(false)}>
            Marketplace
          </Link>
          <Link to="/orders" className={navClass('/orders')} onClick={() => setNavOpen(false)}>
            Orders
          </Link>
          <Link to="/invoices" className={navClass('/invoices')} onClick={() => setNavOpen(false)}>
            Invoices
          </Link>
          <Link to="/account" className={navClass('/account')} onClick={() => setNavOpen(false)}>
            Account
          </Link>
          <Link to="/quotes" className={navClass('/quotes')} onClick={() => setNavOpen(false)}>
            Quotes
          </Link>
          <Link to="/notifications" className={navClass('/notifications')} onClick={() => setNavOpen(false)}>
            Notifications
          </Link>
        </nav>
      </div>
      <div className="pleros-shop-header-actions">
        <ThemeSwitcher compact />
        <Link to="/cart" className="pleros-shop-link pleros-shop-cart-link">
          Cart
          {count > 0 ? <span className="pleros-shop-cart-badge">{count}</span> : null}
        </Link>
        {userEmail ? (
          <div className="pleros-shop-user-menu">
            <button
              type="button"
              className="btn-ghost pleros-shop-user-btn"
              onClick={() => setUserMenuOpen((o) => !o)}
            >
              {userEmail}
            </button>
            {userMenuOpen ? (
              <div className="pleros-card pleros-shop-user-dropdown">
                <button type="button" className="pleros-shop-signout" onClick={() => void signOut()}>
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <Link to="/login" className="btn-primary pleros-shop-signin">
            Sign in
          </Link>
        )}
      </div>
      {navOpen ? (
        <button
          type="button"
          className="pleros-shop-nav-backdrop"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
    </header>
  )
}
