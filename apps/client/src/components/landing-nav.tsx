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
    <nav className="flex items-center gap-2 sm:gap-4" aria-label="Primary">
      <div className="hidden md:flex items-center gap-1 p-1 rounded-md border border-[var(--c-border)] bg-[var(--c-surface)]">
        <a
          href="#features"
          className="px-3 py-1 text-xs font-mono font-semibold uppercase tracking-wider text-[var(--c-text-2)] hover:text-[var(--c-heading)] hover:bg-[var(--c-surface-2)] rounded transition-colors"
        >
          // Features
        </a>
        <a
          href="#simulator"
          className="px-3 py-1 text-xs font-mono font-semibold uppercase tracking-wider text-[var(--c-text-2)] hover:text-[var(--c-heading)] hover:bg-[var(--c-surface-2)] rounded transition-colors"
        >
          // Simulator
        </a>
        <a
          href="#pipeline"
          className="px-3 py-1 text-xs font-mono font-semibold uppercase tracking-wider text-[var(--c-text-2)] hover:text-[var(--c-heading)] hover:bg-[var(--c-surface-2)] rounded transition-colors"
        >
          // Pipeline
        </a>
        <a
          href="#workspaces"
          className="px-3 py-1 text-xs font-mono font-semibold uppercase tracking-wider text-[var(--c-text-2)] hover:text-[var(--c-heading)] hover:bg-[var(--c-surface-2)] rounded transition-colors"
        >
          // Workspaces
        </a>
      </div>

      <div className="flex items-center gap-2">
        <ThemeSwitcher compact />

        {user ? (
          <div className="flex items-center gap-2">
            <Link
              to={targetDashboard}
              className="px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider rounded bg-[var(--c-primary)] text-[var(--c-on-primary)] border-2 border-black shadow-[2px_2px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_#000] transition-all"
            >
              {isBuyer ? 'Open Shop →' : 'Open Workspace →'}
            </Link>
            <button
              type="button"
              className="px-2.5 py-1.5 text-xs font-mono text-[var(--c-text-3)] hover:text-[var(--c-heading)] hover:bg-[var(--c-surface-2)] border border-[var(--c-border)] rounded transition-colors"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="px-3 py-1.5 text-xs font-mono font-semibold text-[var(--c-heading)] hover:bg-[var(--c-surface-2)] border border-[var(--c-border)] rounded transition-colors"
            >
              Sign In
            </Link>
            <Link
              to="/signup"
              className="px-3.5 py-1.5 text-xs font-mono font-bold uppercase tracking-wider rounded bg-[var(--c-primary)] text-[var(--c-on-primary)] border-2 border-black shadow-[2px_2px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_#000] transition-all"
            >
              Deploy Free →
            </Link>
          </div>
        )}
      </div>
    </nav>
  )
}
