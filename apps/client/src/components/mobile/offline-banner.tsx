import { useEffect, useMemo, useState } from 'react'
import {
  actionLabel,
  conflictCount,
  discardFailedActions,
  failedCount,
  queueLength,
  readQueue,
  replayableCount,
  resetFailedForRetry,
} from '@/lib/offline-queue'
import { replayOfflineQueue } from '@/lib/offline-sync'

export function OfflineBanner() {
  const [offline, setOffline] = useState(false)
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState(0)
  const [conflicts, setConflicts] = useState(0)
  const [replayable, setReplayable] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const refreshCounts = () => {
    setOffline(!navigator.onLine)
    setPending(queueLength())
    setFailed(failedCount())
    setConflicts(conflictCount())
    setReplayable(replayableCount())
  }

  useEffect(() => {
    refreshCounts()
    window.addEventListener('online', refreshCounts)
    window.addEventListener('offline', refreshCounts)
    window.addEventListener('pleros-offline-queue-changed', refreshCounts)
    return () => {
      window.removeEventListener('online', refreshCounts)
      window.removeEventListener('offline', refreshCounts)
      window.removeEventListener('pleros-offline-queue-changed', refreshCounts)
    }
  }, [])

  // Auto-drain replayable items when back online — conflicts wait for user action
  useEffect(() => {
    if (offline || replayable === 0) return
    let cancelled = false
    setSyncing(true)
    setMsg(null)
    void replayOfflineQueue()
      .then((result) => {
        if (cancelled) return
        refreshCounts()
        if (result.synced > 0 && result.conflicts === 0 && result.failed === 0) {
          setMsg(`Synced ${result.synced} action(s)`)
        } else if (result.conflicts > 0 || result.failed > 0) {
          setMsg(
            result.conflicts > 0
              ? `${result.conflicts} conflict(s) need attention`
              : `${result.failed} action(s) failed — will retry`,
          )
          setExpanded(true)
        }
      })
      .finally(() => {
        if (!cancelled) setSyncing(false)
      })
    return () => {
      cancelled = true
    }
  }, [offline, replayable])

  const failedItems = useMemo(() => {
    return readQueue().filter((a) => a.status === 'failed' || a.status === 'conflict')
  }, [pending, failed, conflicts])

  async function syncNow(forceConflicts = false) {
    setSyncing(true)
    setMsg(null)
    try {
      if (forceConflicts) resetFailedForRetry()
      const result = await replayOfflineQueue({ retryConflicts: forceConflicts })
      refreshCounts()
      if (result.synced > 0 && result.conflicts === 0 && result.failed === 0) {
        setMsg(`Synced ${result.synced} action(s)`)
        setExpanded(false)
      } else if (result.conflicts > 0 || result.failed > 0) {
        setMsg(
          result.conflicts > 0
            ? `${result.conflicts} conflict(s) need attention`
            : `${result.failed} action(s) failed — will retry`,
        )
        setExpanded(true)
      } else {
        setMsg('Queue empty')
      }
    } finally {
      setSyncing(false)
    }
  }

  function discardFailed() {
    const n = discardFailedActions()
    refreshCounts()
    setMsg(n > 0 ? `Discarded ${n} failed action(s)` : 'Nothing to discard')
    setExpanded(false)
  }

  const hasFailures = failed > 0
  if (!offline && pending === 0 && !msg) return null

  const bg = offline
    ? 'var(--c-warning)'
    : hasFailures
      ? 'var(--c-danger)'
      : 'var(--c-primary)'
  const fg = offline ? 'var(--c-bg)' : hasFailures ? '#fff' : 'var(--c-on-primary)'

  return (
    <div
      style={{
        background: bg,
        color: fg,
        padding: 8,
        textAlign: 'center',
        fontSize: 13,
        fontWeight: 600,
        borderRadius: 8,
        marginBottom: 12,
      }}
    >
      {offline ? 'Offline — actions queue locally and sync when online' : null}
      {!offline && syncing && replayable > 0 ? 'Syncing queued actions…' : null}
      {!offline && !syncing && pending > 0 && !hasFailures ? `${pending} queued action(s)` : null}
      {!offline && !syncing && hasFailures ? (
        <span>
          {conflicts > 0
            ? `${conflicts} sync conflict(s)`
            : `${failed} failed sync(s)`}
          {pending > failed ? ` · ${pending - failed} still queued` : null}
        </span>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 6 }}>
        {pending > 0 && !offline && !syncing ? (
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: 12, padding: '2px 8px', color: fg, borderColor: 'currentColor' }}
            onClick={() => void syncNow(hasFailures)}
          >
            {hasFailures ? 'Retry failed' : 'Retry now'}
          </button>
        ) : null}
        {hasFailures && !offline && !syncing ? (
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: 12, padding: '2px 8px', color: fg, borderColor: 'currentColor' }}
            onClick={discardFailed}
          >
            Discard failed
          </button>
        ) : null}
        {hasFailures && failedItems.length > 0 ? (
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: 12, padding: '2px 8px', color: fg, borderColor: 'currentColor' }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>
        ) : null}
      </div>

      {expanded && failedItems.length > 0 ? (
        <ul
          style={{
            listStyle: 'none',
            margin: '8px 0 0',
            padding: 0,
            textAlign: 'left',
            fontWeight: 400,
            fontSize: 12,
            opacity: 0.95,
          }}
        >
          {failedItems.map((a) => (
            <li
              key={a.id}
              style={{
                padding: '6px 8px',
                marginBottom: 4,
                borderRadius: 6,
                background: 'rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {actionLabel(a.type)}
                {a.status === 'conflict' ? ' · conflict' : ' · failed'}
              </div>
              <div style={{ marginTop: 2 }}>{a.lastError ?? 'Unknown error'}</div>
            </li>
          ))}
        </ul>
      ) : null}

      {msg ? <span style={{ display: 'block', fontWeight: 400, marginTop: 4 }}>{msg}</span> : null}
    </div>
  )
}
