import { Link } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { getSessionUser, isSignedIn, signOut, type SessionPayload } from '@/lib/auth-session'
import { STOREFRONT_AUTH_EVENT } from '@/lib/auth-events'

export function LandingNav() {
  const [user, setUser] = useState<SessionPayload | null>(null)

  const refresh = useCallback(() => {
    if (isSignedIn()) {
      setUser(getSessionUser())
    } else {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    refresh()
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'pleros.accessToken' || e.key === null) refresh()
    }
    const onAuth = () => refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener(STOREFRONT_AUTH_EVENT, onAuth)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(STOREFRONT_AUTH_EVENT, onAuth)
    }
  }, [refresh])

  const role = user?.role?.toUpperCase() ?? ''
  const isBuyer = role === 'BUYER' || role === 'B2B_BUYER' || role === 'CUSTOMER'
  const isDriver = role === 'DRIVER'
  const isWarehouse = role === 'WAREHOUSE_STAFF'
  const targetDashboard = isBuyer
    ? '/catalog'
    : isDriver
      ? '/m/delivery'
      : isWarehouse
        ? '/m/warehouse'
        : '/admin'

  return (
    <nav className="pleros-landing-nav" aria-label="Primary">
      <a href="#features" className="pleros-landing-nav-link">
        Features
      </a>
      <a href="#solutions" className="pleros-landing-nav-link">
        Solutions
      </a>
      <a href="#workspaces" className="pleros-landing-nav-link">
        Workspaces
      </a>
      <ThemeSwitcher compact />
      {user ? (
        <>
          <Link to={targetDashboard} className="pleros-landing-nav-cta">
            {isBuyer ? 'Go to Shop →' : 'Open Dashboard →'}
          </Link>
          <button
            type="button"
            className="pleros-landing-nav-link !text-xs opacity-75 hover:opacity-100"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </>
      ) : (
        <>
          <Link to="/login" className="pleros-landing-nav-link">
            Sign in
          </Link>
          <Link to="/signup" className="pleros-landing-nav-cta">
            Get started
          </Link>
        </>
      )}
    </nav>
  )
}
