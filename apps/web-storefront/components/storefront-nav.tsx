'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { STOREFRONT_AUTH_EVENT, emitStorefrontAuthChanged } from '@/lib/auth-events'
import { B2B_CART_KEY, cartTotalLines, readCart } from '@/lib/b2b-cart'

export function StorefrontNav() {
  const [cartCount, setCartCount] = useState(0)
  const [hasToken, setHasToken] = useState(false)

  const refreshCart = useCallback(() => {
    setCartCount(cartTotalLines(readCart()))
  }, [])

  const refreshAuth = useCallback(() => {
    setHasToken(Boolean(typeof window !== 'undefined' && window.localStorage.getItem('cosmos.accessToken')))
  }, [])

  useEffect(() => {
    refreshCart()
    refreshAuth()
    const onStorage = (e: StorageEvent) => {
      if (e.key === B2B_CART_KEY || e.key === null) refreshCart()
      if (e.key === 'cosmos.accessToken' || e.key === null) refreshAuth()
    }
    const onCustomCart = () => refreshCart()
    const onAuth = () => refreshAuth()
    window.addEventListener('storage', onStorage)
    window.addEventListener('cosmos-cart-changed', onCustomCart)
    window.addEventListener(STOREFRONT_AUTH_EVENT, onAuth)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('cosmos-cart-changed', onCustomCart)
      window.removeEventListener(STOREFRONT_AUTH_EVENT, onAuth)
    }
  }, [refreshCart, refreshAuth])

  const linkStyle = { color: '#a5b4fc', textDecoration: 'none' as const, fontSize: 14 }

  function logout() {
    window.localStorage.removeItem('cosmos.accessToken')
    window.localStorage.removeItem('cosmos.refreshToken')
    emitStorefrontAuthChanged()
    window.location.href = '/'
  }

  return (
    <header
      style={{
        borderBottom: '1px solid #1f2740',
        background: '#0a0a12',
        padding: '12px 22px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 16,
        justifyContent: 'space-between',
      }}
    >
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
        <Link href="/" style={{ ...linkStyle, fontWeight: 700, color: '#e2e8f0' }}>
          Cosmos B2B
        </Link>
        <Link href="/catalog" style={linkStyle}>
          Catalog
        </Link>
        <Link href="/cart" style={linkStyle}>
          Cart{cartCount > 0 ? ` (${cartCount})` : ''}
        </Link>
        <Link href="/quotes" style={linkStyle}>
          Quotes
        </Link>
        <Link href="/quotes/new" style={linkStyle}>
          New quote
        </Link>
        {hasToken ? (
          <Link href="/orders" style={linkStyle}>
            Orders
          </Link>
        ) : null}
      </nav>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {hasToken ? (
          <button
            type="button"
            onClick={() => logout()}
            style={{
              background: 'transparent',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#94a3b8',
              fontSize: 13,
              padding: '6px 12px',
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        ) : (
          <Link href="/login" style={{ ...linkStyle, fontSize: 13 }}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  )
}
