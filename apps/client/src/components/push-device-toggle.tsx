import { useEffect, useState } from 'react'
import { axiosErr } from '@/lib/axios-error'
import {
  disablePush,
  enablePush,
  getPushStatus,
  sendTestPush,
  syncPushSubscription,
  type PushStatus,
} from '@/lib/push'

const NOTE: Record<PushStatus, string> = {
  unsupported: "This browser can't show push notifications.",
  'needs-install':
    'On iPhone and iPad, add this site to your Home Screen (Share → Add to Home Screen), open it from there, then turn notifications on. Needs iOS 16.4 or later.',
  'not-configured': 'Push notifications are not set up for this store yet.',
  denied: 'Notifications are blocked for this site. Allow them in your browser settings, then try again.',
  off: 'Get alerts like "your order shipped" on this device, even when the site is closed.',
  on: 'This device gets alerts like "your order shipped".',
}

/** Turns browser push on or off for the signed-in buyer on this device. */
export function PushDeviceToggle() {
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await getPushStatus()
        // Re-link an existing subscription to whoever is signed in now (and renew it if the key changed).
        if (next === 'on') await syncPushSubscription()
        if (!cancelled) setStatus(next)
      } catch {
        if (!cancelled) setStatus('unsupported')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function run(action: () => Promise<PushStatus | void>, done?: string) {
    setBusy(true)
    setMessage(null)
    try {
      const next = await action()
      setStatus(next ?? (await getPushStatus()))
      if (done) setMessage(done)
    } catch (e: unknown) {
      setMessage(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--c-border)' }}>
      <p style={{ fontSize: 14, margin: 0, color: 'var(--c-heading)' }}>Push notifications on this device</p>
      <p className="pleros-shop-muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>
        {NOTE[status]}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status === 'off' || status === 'denied' ? (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void run(enablePush)}>
            {busy ? 'Turning on…' : 'Turn on'}
          </button>
        ) : null}
        {status === 'on' ? (
          <>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void run(disablePush)}>
              Turn off
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void run(sendTestPush, 'Test notification sent.')}
            >
              Send a test
            </button>
          </>
        ) : null}
      </div>
      {message ? <p style={{ fontSize: 13, marginTop: 8 }}>{message}</p> : null}
    </div>
  )
}
