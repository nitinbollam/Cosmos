import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export function RequireMobileAuth({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const pathname = useLocation().pathname ?? '/m'
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = window.localStorage.getItem('pleros.accessToken')
    if (!token) {
      const next = pathname.startsWith('/m/') ? `?next=${encodeURIComponent(pathname)}` : ''
      navigate(`/m/login${next}`)
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
