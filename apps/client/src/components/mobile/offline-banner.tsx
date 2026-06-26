import { useEffect, useState } from 'react'
import { queueLength, readQueue } from '@/lib/offline-queue'
import { replayOfflineQueue } from '@/lib/offline-sync'

export function OfflineBanner() {
  const [offline, setOffline] = useState(false)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const sync = () => {
      setOffline(!navigator.onLine)
      setPending(queueLength())
    }
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    window.addEventListener('pleros-offline-queue-changed', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
      window.removeEventListener('pleros-offline-queue-changed', sync)
    }
  }, [])

  async function syncNow() {
    setSyncing(true)
    setMsg(null)
    try {
      const result = await replayOfflineQueue()
      setMsg(result.synced > 0 ? `Synced ${result.synced} action(s)` : readQueue().length ? 'Some actions failed' : 'Queue empty')
      setPending(queueLength())
    } finally {
      setSyncing(false)
    }
  }

  if (!offline && pending === 0 && !msg) return null

  return (
    <div
      style={{
        background: offline ? 'var(--c-warning)' : 'var(--c-primary)',
        color: offline ? 'var(--c-bg)' : 'var(--c-on-primary)',
        padding: 8,
        textAlign: 'center',
        fontSize: 13,
        fontWeight: 600,
        borderRadius: 8,
        marginBottom: 12,
      }}
    >
      {offline ? 'Offline — actions queue locally' : null}
      {!offline && pending > 0 ? `${pending} queued action(s)` : null}
      {pending > 0 && !offline ? (
        <button
          type="button"
          className="btn-ghost"
          style={{ marginLeft: 8, fontSize: 12, padding: '2px 8px' }}
          disabled={syncing}
          onClick={() => void syncNow()}
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      ) : null}
      {msg ? <span style={{ display: 'block', fontWeight: 400, marginTop: 4 }}>{msg}</span> : null}
    </div>
  )
}
