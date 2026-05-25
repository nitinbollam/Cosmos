'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = window.localStorage.getItem('cosmos.accessToken')
    if (!token) {
      const next = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`
      router.replace(`/login${next}`)
      return
    }
    setReady(true)
  }, [pathname, router])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-cosmos-text-3 text-sm">
        Checking session…
      </div>
    )
  }

  return <>{children}</>
}
