import { Link } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { isSignedIn, signOut } from '@/lib/auth-session'
import { STOREFRONT_AUTH_EVENT } from '@/lib/auth-events'

export function LandingNav() {
  const [signedIn, setSignedIn] = useState(false)

  const refresh = useCallback(() => {
    setSignedIn(isSignedIn())
  }, [])

  useEffect(() => {
    refresh()
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'cosmos.accessToken' || e.key === null) refresh()
    }
    const onAuth = () => refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener(STOREFRONT_AUTH_EVENT, onAuth)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(STOREFRONT_AUTH_EVENT, onAuth)
    }
  }, [refresh])

  return (
    <nav className="cosmos-landing-nav" aria-label="Primary">
      <a href="#features" className="cosmos-landing-nav-link">
        Features
      </a>
      <a href="#workspaces" className="cosmos-landing-nav-link">
        Workspaces
      </a>
      <ThemeSwitcher compact />
      {signedIn ? (
        <button
          type="button"
          className="cosmos-landing-nav-link"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      ) : (
        <Link to="/login" className="cosmos-landing-nav-link">
          Sign in
        </Link>
      )}
      <Link to="/signup" className="cosmos-landing-nav-cta">
        Get started
      </Link>
    </nav>
  )
}
