import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/** B2B marketplace browse requires a signed-in tenant staff session (not portal-only). */
export function RequireMarketplaceShop({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const pathname = useLocation().pathname ?? '/marketplace'
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = window.localStorage.getItem('pleros.accessToken')
    if (!token) {
      navigate(`/login?next=${encodeURIComponent(pathname)}`)
      return
    }
    setReady(true)
  }, [pathname, navigate])

  if (!ready) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-pleros-text-3 text-sm">
        Checking session…
      </div>
    )
  }

  return <>{children}</>
}
