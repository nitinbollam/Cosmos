import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'pleros.pwaInstallDismissed'

function isStandalone(): boolean {
  if (typeof window === 'undefined') return true
  const mq = window.matchMedia('(display-mode: standalone)').matches
  const ios = 'standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return mq || ios
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const webkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
  return iOS && webkit
}

export function PwaInstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIos, setShowIos] = useState(false)
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    if (isStandalone()) return
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return
    } catch {
      /* ignore */
    }

    if (isIosSafari()) {
      setShowIos(true)
      setHidden(false)
      return
    }

    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setHidden(false)
    }
    window.addEventListener('beforeinstallprompt', onBip)
    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  function dismiss() {
    setHidden(true)
    setDeferred(null)
    setShowIos(false)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    dismiss()
  }

  if (hidden) return null

  return (
    <div
      className="pleros-mobile-card"
      style={{
        marginBottom: 12,
        padding: 12,
        fontSize: 13,
        border: '1px solid var(--c-border)',
        background: 'var(--c-surface-2, var(--c-bg))',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, color: 'var(--c-heading)' }}>Install Pleros Mobile</p>
          {showIos ? (
            <p style={{ margin: '6px 0 0', opacity: 0.75, lineHeight: 1.4 }}>
              Tap <strong>Share</strong> then <strong>Add to Home Screen</strong> for a full-screen field app with offline
              queue support.
            </p>
          ) : (
            <p style={{ margin: '6px 0 0', opacity: 0.75, lineHeight: 1.4 }}>
              Add to your home screen for faster warehouse, delivery, and sales access — works offline for queued
              actions.
            </p>
          )}
        </div>
        <button type="button" className="btn-ghost !py-1 !px-2 !text-xs" onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
      {!showIos && deferred ? (
        <button type="button" className="btn-primary w-full" style={{ marginTop: 10 }} onClick={() => void install()}>
          Install app
        </button>
      ) : null}
    </div>
  )
}
