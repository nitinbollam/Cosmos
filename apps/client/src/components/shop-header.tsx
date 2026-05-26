import Image from '@/components/cosmos-img'
import { Link } from 'react-router-dom'
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

  return (
    <header className="cosmos-shop-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Link to="/catalog" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <Image src="/cosmos-logo.png" alt="Cosmos" width={40} height={40} style={{ height: 40, width: 'auto' }} priority />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--c-heading)', fontSize: 14 }}>
            {tenantLabel}
          </span>
        </Link>
        <nav style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <Link to="/catalog" className="cosmos-shop-link">
            Catalog
          </Link>
          <Link to="/orders" className="cosmos-shop-link">
            Orders
          </Link>
          <Link to="/quotes" className="cosmos-shop-link">
            Quotes
          </Link>
        </nav>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/cart" className="cosmos-shop-link" style={{ position: 'relative' }}>
          Cart
          {count > 0 ? (
            <span
              style={{
                marginLeft: 6,
                background: 'var(--c-primary)',
                color: 'var(--c-primary-fg)',
                borderRadius: 999,
                padding: '2px 8px',
                fontSize: 11,
                border: '1px solid var(--c-border)',
              }}
            >
              {count}
            </span>
          ) : null}
        </Link>
        {userEmail ? (
          <div style={{ position: 'relative' }}>
            <button type="button" className="btn-ghost !py-2 !px-3" onClick={() => setMenuOpen((o) => !o)} style={{ fontSize: 13 }}>
              {userEmail}
            </button>
            {menuOpen ? (
              <div className="cosmos-card !p-0 mt-2 absolute right-0 z-50 min-w-[180px]">
                <button
                  type="button"
                  className="w-full text-left px-4 py-3 text-sm"
                  style={{ color: 'var(--c-danger)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onClick={() => logout()}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <Link to="/login" className="btn-primary !no-underline inline-block text-center" style={{ fontSize: 13 }}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  )
}
