import { Link } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { actionLabel, belongsTo, patchAction, readQueue, removeAction } from '@/lib/offline-queue'
import { replayOfflineQueue } from '@/lib/offline-sync'
import { needsAttention, queueRows, type QueueRow } from '@/lib/queue-screen'
import { currentIdentity } from '@/lib/session-identity'

/** Everything this device has queued for the signed-in user, with a way out for each item. */
export default function QueuePage() {
  const [rows, setRows] = useState<QueueRow[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const refresh = useCallback(() => {
    const me = currentIdentity('mobile')
    setRows(queueRows(readQueue().filter((a) => !a.userId || belongsTo(a, me)), actionLabel))
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('pleros-offline-queue-changed', refresh)
    return () => window.removeEventListener('pleros-offline-queue-changed', refresh)
  }, [refresh])

  async function retry(id: string) {
    setBusy(true)
    setMsg(null)
    patchAction(id, { status: 'pending', lastError: undefined, lastFailedAt: undefined })
    try {
      const r = await replayOfflineQueue()
      setMsg(r.synced > 0 ? 'Sent.' : r.conflicts + r.failed > 0 ? 'Still not accepted.' : 'Waiting for a connection.')
    } finally {
      setBusy(false)
      refresh()
    }
  }

  function discard(id: string) {
    if (!window.confirm('Discard this? It will not be sent.')) return
    removeAction(id)
    setMsg('Discarded.')
  }

  const attention = needsAttention(rows)
  return (
    <div>
      <Link to="/m/home" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>← Home</Link>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Unsent work</h1>
      <p style={{ fontSize: 13, opacity: 0.75 }}>
        {rows.length === 0 ? 'Everything is sent.' : `${rows.length} item${rows.length === 1 ? '' : 's'} on this phone${attention ? `, ${attention} need${attention === 1 ? 's' : ''} a decision` : ''}.`}
      </p>
      {msg && <p style={{ fontSize: 13 }}>{msg}</p>}
      {rows.map((r) => (
        <div key={r.id} className="pleros-mobile-card" style={r.kind === 'conflict' ? { borderColor: 'var(--c-danger)' } : undefined}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{r.label}</strong>
            <span style={{ fontSize: 12, opacity: 0.75 }}>{r.queuedAt}</span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.8 }}>{r.detail}</p>
          {r.attempts > 0 && <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.6 }}>Tried {r.attempts} time{r.attempts === 1 ? '' : 's'}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void retry(r.id)}>Retry</button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => discard(r.id)}>Discard</button>
          </div>
        </div>
      ))}
    </div>
  )
}
