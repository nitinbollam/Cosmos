/**
 * Browser push opt-in for the signed-in buyer. The subscription belongs to this browser (one per
 * site), so it is dropped whenever that buyer's data leaves the device (see wipeUserData).
 */
/** Loaded on use, so the sign-out helpers below work (and test) without the API client. */
async function api() {
  return (await import('@/lib/api')).api
}

export type PushStatus =
  /** This browser can't receive push. */
  | 'unsupported'
  /**
   * iPhone/iPad in a browser tab. iOS only delivers web push to sites installed on the Home
   * Screen, and the store has no installable manifest yet (the current one is the staff app's).
   */
  | 'ios-unavailable'
  /** The server has no push keys set up yet. */
  | 'not-configured'
  /** The user blocked notifications for this site in the browser. */
  | 'denied'
  | 'off'
  | 'on'

function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function isIosBrowserTab(): boolean {
  if (typeof navigator === 'undefined') return false
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  return ios && !standalone
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'))
  } catch {
    return null
  }
}

async function publicKey(): Promise<string | null> {
  const config = await (await api()).get<{ webPushPublicKey: string | null }>('/push/config')
  return config.webPushPublicKey
}

function keyBytes(base64Url: string): Uint8Array {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

/** False when the subscription was made with an older server key (it would no longer deliver). */
function madeWithKey(subscription: PushSubscription, key: string): boolean {
  const used = subscription.options?.applicationServerKey
  if (!used) return true
  const a = new Uint8Array(used)
  const b = keyBytes(key)
  return a.length === b.length && a.every((v, i) => v === b[i])
}

async function subscribe(reg: ServiceWorkerRegistration, key: string): Promise<PushSubscription> {
  const existing = await reg.pushManager.getSubscription()
  if (existing && madeWithKey(existing, key)) return existing
  if (existing) await existing.unsubscribe()
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource })
}

async function register(subscription: PushSubscription) {
  const { endpoint, keys } = subscription.toJSON()
  await (await api()).post('/push/devices', { kind: 'webpush', endpoint, keys })
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!isSupported()) return isIosBrowserTab() ? 'ios-unavailable' : 'unsupported'
  if (!(await publicKey())) return 'not-configured'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await registration()
  const subscription = await reg?.pushManager.getSubscription()
  return subscription && Notification.permission === 'granted' ? 'on' : 'off'
}

/** Ask for permission and turn push on for this browser. Call only from a click. */
export async function enablePush(): Promise<PushStatus> {
  if (!isSupported()) return isIosBrowserTab() ? 'ios-unavailable' : 'unsupported'
  const key = await publicKey()
  if (!key) return 'not-configured'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  const reg = await registration()
  if (!reg) return 'unsupported'
  await register(await subscribe(reg, key))
  return 'on'
}

/** Turn push off for this browser: unsubscribe here, then tell the server (best effort). */
export async function disablePush(): Promise<void> {
  if (!isSupported()) return
  const subscription = await (await registration())?.pushManager.getSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await (await api()).post('/push/devices/remove', { token: endpoint }).catch(() => undefined) // swallow-ok: the server drops dead endpoints itself when a push to it fails
}

/**
 * Keep an existing subscription linked to whoever is signed in now, and renew it if the server's
 * key changed. Does nothing (and never prompts) unless push was already turned on here.
 */
export async function syncPushSubscription(): Promise<void> {
  if (!isSupported() || Notification.permission !== 'granted') return
  const reg = await registration()
  const existing = await reg?.pushManager.getSubscription()
  if (!reg || !existing) return
  const key = await publicKey()
  if (!key) return
  await register(await subscribe(reg, key))
}

export async function sendTestPush(): Promise<void> {
  await (await api()).post('/push/test')
}

/**
 * Drop this browser's subscription without calling the server, so it works after the session is
 * gone (sign-out, or a different user signing in). The push service then answers 410 and the
 * server forgets the device on its next send.
 */
export async function dropPushSubscription(): Promise<void> {
  if (!isSupported()) return
  try {
    const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
    await subscription?.unsubscribe()
  } catch {
    /* nothing to drop */
  }
}

/**
 * Sign-out: forget this browser's push subscription before the page goes away. The browser
 * unsubscribes first (that alone stops delivery: the push service answers 410 from then on), then
 * the server copy is removed with the still-valid token (raw fetch: the API client's 401 handling
 * must not redirect mid sign-out). Bounded, so a slow network can't hold sign-out.
 */
export async function forgetPushOnSignOut(gatewayBaseUrl: string, accessToken: string | null): Promise<void> {
  if (!isSupported()) return
  const forget = async () => {
    const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
    if (!subscription) return
    const endpoint = subscription.endpoint
    await subscription.unsubscribe()
    if (accessToken) {
      await fetch(`${gatewayBaseUrl}/push/devices/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ token: endpoint }),
      }).catch(() => undefined) // swallow-ok: sign-out must finish even when the server cannot be reached
    }
  }
  await Promise.race([forget().catch(() => undefined) /* swallow-ok: sign-out must finish even when the server cannot be reached */, new Promise((r) => setTimeout(r, 2000))])
}
