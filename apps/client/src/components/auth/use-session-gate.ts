import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getAccessToken, getSessionUser, refreshTokens } from '@/lib/auth-session'
import { tokenExpiresInMs, type Surface } from '@/lib/session-identity'

/**
 * A portal-only buyer: the default STAFF role with no custom permissions grants nothing but
 * `portal.*`. The server already refuses them staff data; this just keeps them out of the
 * staff shells. Accounts with custom permissions are left alone.
 */
function isPortalOnlyBuyer(surface: Surface): boolean {
  const user = getSessionUser(surface)
  return user?.role === 'STAFF' && (!user.permissions || user.permissions.length === 0)
}

/**
 * Shared logic for route guards. Resolves to `true` once the page may render:
 * - no token → sign-in page
 * - expired token → refresh first; if the session is over → sign-in page; if we're just
 *   offline → render anyway so cached and offline screens keep working
 * - `staffOnly` and a portal-only buyer → the buyer catalog
 */
export function useSessionGate({
  surface,
  loginPath,
  staffOnly = false,
}: {
  /** Which area's login this guard checks (admin, buyer portal or mobile). */
  surface: Surface
  loginPath: string
  staffOnly?: boolean
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname ?? '/'
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const toLogin = () => {
      const next = pathname === '/admin' || pathname === '/admin/' || pathname === '/m' ? '' : `?next=${encodeURIComponent(pathname)}`
      navigate(`${loginPath}${next}`, { replace: true })
    }

    void (async () => {
      const token = getAccessToken(surface)
      if (!token) return toLogin()
      if ((tokenExpiresInMs(token) ?? 1) <= 0) {
        try {
          if (!(await refreshTokens(surface))) return toLogin()
        } catch {
          /* offline / auth service down: keep the session and render */
        }
      }
      if (cancelled) return
      if (staffOnly && isPortalOnlyBuyer(surface)) {
        navigate('/catalog', { replace: true })
        return
      }
      setReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [pathname, navigate, surface, loginPath, staffOnly])

  return ready
}
