import { CosmosLogo } from '@/components/cosmos-logo'
import { Link, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { useCartStore } from '@/stores/cart.store'
import { emitStorefrontAuthChanged, STOREFRONT_AUTH_EVENT } from '@/lib/auth-events'
import { jwtEmail } from '@/lib/jwt'
import { clearB2bSession } from '@/lib/session'

export function ShopHeader() {
  const location = useLocation()
  const count = useCartStore((s) => s.count())
  const [tenantLabel, setTenantLabel] = useState('Your business')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const refreshAuth = useCallback(() => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('cosmos.accessToken') : null
    setUserEmail(jwtEmail(token))
    const tid = typeof window !== 'undefined' ? window.sessionStorage.getItem('cosmos.tenantId') : null
    if (tid) setTenantLabel(tid.slice(0, 8))
  }, [])

  useEffect(() => {
    refreshAuth()
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'cosmos.accessToken' || e.key === null) refreshAuth()
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
    document.body.classList.toggle('cosmos-shop-menu-open', navOpen)
    return () => document.body.classList.remove('cosmos-shop-menu-open')
  }, [navOpen])

  function logout() {
    window.localStorage.removeItem('cosmos.accessToken')
    window.localStorage.removeItem('cosmos.refreshToken')
    clearB2bSession()
    emitStorefrontAuthChanged()
    window.location.href = '/'
  }

  function navClass(path: string) {
    const active = location.pathname === path || location.pathname.startsWith(`${path}/`)
    return `cosmos-shop-link${active ? ' cosmos-shop-link--active' : ''}`
  }

  return (
    <header className="cosmos-shop-header">
      <div className="cosmos-shop-header-row">
        <button
          type="button"
          className="cosmos-shop-menu-btn"
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
        <Link to="/catalog" className="cosmos-shop-brand">
          <CosmosLogo variant="mark" size="sm" />
          <span className="cosmos-shop-brand-label">{tenantLabel}</span>
        </Link>
        <nav className={`cosmos-shop-nav${navOpen ? ' cosmos-shop-nav--open' : ''}`}>
          <Link to="/catalog" className={navClass('/catalog')} onClick={() => setNavOpen(false)}>
            Catalog
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
        </nav>
      </div>
      <div className="cosmos-shop-header-actions">
        <Link to="/cart" className="cosmos-shop-link cosmos-shop-cart-link">
          Cart
          {count > 0 ? <span className="cosmos-shop-cart-badge">{count}</span> : null}
        </Link>
        {userEmail ? (
          <div className="cosmos-shop-user-menu">
            <button
              type="button"
              className="btn-ghost cosmos-shop-user-btn"
              onClick={() => setUserMenuOpen((o) => !o)}
            >
              {userEmail}
            </button>
            {userMenuOpen ? (
              <div className="cosmos-card cosmos-shop-user-dropdown">
                <button type="button" className="cosmos-shop-signout" onClick={() => logout()}>
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <Link to="/login" className="btn-primary cosmos-shop-signin">
            Sign in
          </Link>
        )}
      </div>
      {navOpen ? (
        <button
          type="button"
          className="cosmos-shop-nav-backdrop"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
    </header>
  )
}
