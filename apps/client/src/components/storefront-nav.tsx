import { Link } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { PlerosLogo } from '@/components/pleros-logo'
import { STOREFRONT_AUTH_EVENT } from '@/lib/auth-events'
import { signOut } from '@/lib/auth-session'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { B2B_CART_KEY, cartTotalLines, readCart } from '@/lib/b2b-cart'

export function StorefrontNav() {
  const [cartCount, setCartCount] = useState(0)
  const [hasToken, setHasToken] = useState(false)

  const refreshCart = useCallback(() => {
    setCartCount(cartTotalLines(readCart()))
  }, [])

  const refreshAuth = useCallback(() => {
    setHasToken(Boolean(typeof window !== 'undefined' && window.localStorage.getItem('pleros.accessToken')))
  }, [])

  useEffect(() => {
    refreshCart()
    refreshAuth()
    const onStorage = (e: StorageEvent) => {
      if (e.key === B2B_CART_KEY || e.key === null) refreshCart()
      if (e.key === 'pleros.accessToken' || e.key === null) refreshAuth()
    }
    const onCustomCart = () => refreshCart()
    const onAuth = () => refreshAuth()
    window.addEventListener('storage', onStorage)
    window.addEventListener('pleros-cart-changed', onCustomCart)
    window.addEventListener(STOREFRONT_AUTH_EVENT, onAuth)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('pleros-cart-changed', onCustomCart)
      window.removeEventListener(STOREFRONT_AUTH_EVENT, onAuth)
    }
  }, [refreshCart, refreshAuth])

  return (
    <header className="pleros-shop-header">
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
        <Link to="/admin" style={{ textDecoration: 'none' }}>
          <PlerosLogo size="sm" />
        </Link>
        <Link to="/catalog" className="pleros-shop-link">
          Catalog
        </Link>
        <Link to="/cart" className="pleros-shop-link">
          Cart{cartCount > 0 ? ` (${cartCount})` : ''}
        </Link>
        <Link to="/quotes" className="pleros-shop-link">
          Quotes
        </Link>
        <Link to="/quotes/new" className="pleros-shop-link">
          New quote
        </Link>
        {hasToken ? (
          <Link to="/orders" className="pleros-shop-link">
            Orders
          </Link>
        ) : null}
      </nav>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <ThemeSwitcher compact />
        {hasToken ? (
          <button type="button" onClick={() => void signOut()} className="btn-ghost" style={{ padding: '6px 12px', fontSize: 13 }}>
            Sign out
          </button>
        ) : (
          <Link to="/admin/login" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  )
}
