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

  // Auto-drain when back online — no tap required (Background Sync / online listener also do this)
  useEffect(() => {
    if (offline || pending === 0) return
    let cancelled = false
    setSyncing(true)
    setMsg(null)
    void replayOfflineQueue()
      .then((result) => {
        if (cancelled) return
        setPending(queueLength())
        if (result.synced > 0) {
          setMsg(`Synced ${result.synced} action(s)`)
        } else if (readQueue().length > 0) {
          setMsg('Some actions failed — will retry')
        }
      })
      .finally(() => {
        if (!cancelled) setSyncing(false)
      })
    return () => {
      cancelled = true
    }
  }, [offline, pending])

  async function syncNow() {
    setSyncing(true)
    setMsg(null)
    try {
      const result = await replayOfflineQueue()
      setMsg(
        result.synced > 0
          ? `Synced ${result.synced} action(s)`
          : readQueue().length
            ? 'Some actions failed — will retry'
            : 'Queue empty',
      )
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
      {offline ? 'Offline — actions queue locally and sync when online' : null}
      {!offline && syncing && pending > 0 ? 'Syncing queued actions…' : null}
      {!offline && !syncing && pending > 0 ? `${pending} queued action(s)` : null}
      {pending > 0 && !offline && !syncing ? (
        <button
          type="button"
          className="btn-ghost"
          style={{ marginLeft: 8, fontSize: 12, padding: '2px 8px' }}
          onClick={() => void syncNow()}
        >
          Retry now
        </button>
      ) : null}
      {msg ? <span style={{ display: 'block', fontWeight: 400, marginTop: 4 }}>{msg}</span> : null}
    </div>
  )
}
