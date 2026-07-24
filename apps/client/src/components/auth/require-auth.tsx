import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const pathname = useLocation().pathname ?? '/'
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = window.localStorage.getItem('pleros.accessToken')
    if (!token) {
      const next = pathname === '/admin' || pathname === '/admin/' ? '' : `?next=${encodeURIComponent(pathname)}`
      navigate(`/admin/login${next}`)
      return
    }
    setReady(true)
  }, [pathname, navigate])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-pleros-text-3 text-sm">
        Checking session…
      </div>
    )
  }

  return <>{children}</>
}
