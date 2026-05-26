import { useEffect, useState } from 'react'

export function OfflineBanner() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  if (!offline) return null
  return (
    <div
      style={{
        background: '#f59e0b',
        color: '#0f172a',
        padding: 8,
        textAlign: 'center',
        fontSize: 13,
        fontWeight: 600,
        borderRadius: 8,
        marginBottom: 12,
      }}
    >
      Offline — changes queue locally and sync when back online
    </div>
  )
}
