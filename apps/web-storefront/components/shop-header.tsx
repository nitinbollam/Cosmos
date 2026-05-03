'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useCartStore } from '@/stores/cart.store'
import { emitStorefrontAuthChanged, STOREFRONT_AUTH_EVENT } from '@/lib/auth-events'
import { jwtEmail } from '@/lib/jwt'
import { clearB2bSession } from '@/lib/session'

export function ShopHeader() {
  const count = useCartStore((s) => s.count())
  const [tenantLabel, setTenantLabel] = useState('Your business')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

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

  function logout() {
    window.localStorage.removeItem('cosmos.accessToken')
    window.localStorage.removeItem('cosmos.refreshToken')
    clearB2bSession()
    emitStorefrontAuthChanged()
    window.location.href = '/'
  }

  const linkStyle = { color: 'var(--c-text-2)', textDecoration: 'none' as const, fontSize: 14, fontWeight: 600 }

  return (
    <header
      style={{
        borderBottom: '1px solid var(--c-border)',
        background: '#000000',
        padding: '12px 24px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 16,
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Link href="/catalog" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Image src="/cosmos-logo.png" alt="Cosmos" width={40} height={40} style={{ height: 40, width: 'auto' }} priority />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--c-white)', fontSize: 14 }}>
            {tenantLabel}
          </span>
        </Link>
        <nav style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <Link href="/catalog" style={linkStyle}>
            Catalog
          </Link>
          <Link href="/orders" style={linkStyle}>
            Orders
          </Link>
          <Link href="/quotes" style={linkStyle}>
            Quotes
          </Link>
        </nav>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link href="/cart" style={{ ...linkStyle, position: 'relative' as const }}>
          <span aria-hidden>🛒</span> Cart
          {count > 0 ? (
            <span
              style={{
                marginLeft: 6,
                background: 'var(--c-primary)',
                color: '#fff',
                borderRadius: 999,
                padding: '2px 8px',
                fontSize: 11,
              }}
            >
              {count}
            </span>
          ) : null}
        </Link>
        {userEmail ? (
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn-ghost !py-2 !px-3"
              onClick={() => setMenuOpen((o) => !o)}
              style={{ fontSize: 13 }}
            >
              {userEmail}
            </button>
            {menuOpen ? (
              <div
                className="cosmos-card !p-0 mt-2 absolute right-0 z-50 min-w-[180px]"
                style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
              >
                <button
                  type="button"
                  className="w-full text-left px-4 py-3 text-sm hover:opacity-90"
                  style={{ color: 'var(--c-danger)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onClick={() => logout()}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <Link href="/login" className="btn-primary !no-underline inline-block text-center" style={{ fontSize: 13 }}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  )
}
