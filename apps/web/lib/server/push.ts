/**
 * Push alerts to opted-in devices: browsers through Web Push (VAPID), mobile apps through Expo.
 * A device is registered by the signed-in user it belongs to; registering is the opt-in.
 */
import webpush from 'web-push'
import { authDb, notificationDb } from './db'
import { ApiError } from './session'

export type PushMessage = {
  title: string
  body: string
  /** Same-origin path opened when the notification is tapped, e.g. /orders/abc. */
  url?: string
  /** Notifications with the same tag replace each other instead of stacking. */
  tag?: string
}

export type RegisterPushDeviceInput =
  | { kind: 'webpush'; endpoint: string; keys: { p256dh: string; auth: string } }
  | { kind: 'expo'; token: string }

type WebPushConfig = { publicKey: string; privateKey: string; subject: string }

/** Web Push needs a VAPID key pair (`npx web-push generate-vapid-keys`) and a contact subject. */
export function webPushConfig(): WebPushConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim()
  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}

/**
 * The server POSTs to whatever endpoint a browser registers, so only the browser push services
 * are accepted: Chrome/Edge/Opera/Samsung (FCM), Firefox (Mozilla), Safari (Apple), legacy Edge
 * (Windows). Matched exactly or on a dot boundary, so look-alike hosts don't pass.
 */
const WEB_PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']
const WEB_PUSH_HOST_SUFFIXES = ['.notify.windows.com']

export function isAllowedWebPushEndpoint(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
  const host = url.hostname.toLowerCase()
  return WEB_PUSH_HOSTS.includes(host) || WEB_PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

function base64UrlBytes(value: string): number {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return -1
  return Buffer.from(value, 'base64url').length
}

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$/

function validate(input: RegisterPushDeviceInput) {
  if (input?.kind === 'webpush') {
    if (typeof input.endpoint !== 'string' || !isAllowedWebPushEndpoint(input.endpoint)) {
      throw new ApiError(400, 'Push endpoint must belong to a browser push service')
    }
    const { p256dh, auth } = input.keys ?? ({} as { p256dh?: string; auth?: string })
    // An uncompressed P-256 public key is 65 bytes; the auth secret is 16.
    if (typeof p256dh !== 'string' || base64UrlBytes(p256dh) !== 65) throw new ApiError(400, 'Invalid push key')
    if (typeof auth !== 'string' || base64UrlBytes(auth) !== 16) throw new ApiError(400, 'Invalid push auth secret')
    return { kind: 'webpush', token: input.endpoint, p256dh, auth }
  }
  if (input?.kind === 'expo') {
    if (typeof input.token !== 'string' || !EXPO_TOKEN.test(input.token)) {
      throw new ApiError(400, 'Invalid Expo push token')
    }
    return { kind: 'expo', token: input.token, p256dh: null, auth: null }
  }
  throw new ApiError(400, 'kind must be "webpush" or "expo"')
}

/**
 * Register (or re-register) this device for the signed-in user. A device that was registered
 * by someone else, e.g. on a shared computer, moves to whoever registers it now.
 */
export async function registerPushDevice(tenantId: string, userId: string, input: RegisterPushDeviceInput) {
  const device = validate(input)
  await notificationDb.pushDevice.upsert({
    where: { token: device.token },
    create: { tenantId, userId, ...device },
    update: { tenantId, userId, kind: device.kind, p256dh: device.p256dh, auth: device.auth },
  })
  return { ok: true as const }
}

/** Remove one of the signed-in user's own devices. */
export async function unregisterPushDevice(tenantId: string, userId: string, token: string) {
  const { count } = await notificationDb.pushDevice.deleteMany({ where: { token, tenantId, userId } })
  return { removed: count }
}

/** True when the user has at least one device that can be reached with the current setup. */
export async function hasPushDevice(tenantId: string, userId: string): Promise<boolean> {
  const kinds = webPushConfig() ? ['webpush', 'expo'] : ['expo']
  return (await notificationDb.pushDevice.count({ where: { tenantId, userId, kind: { in: kinds } } })) > 0
}

/** How a message leaves the server. Swapped out in tests. */
export type PushTransport = {
  /** Returns the push service's HTTP status. */
  webPush(device: { token: string; p256dh: string; auth: string }, payload: string, config: WebPushConfig): Promise<number>
  /** Returns one Expo ticket per message, in order. */
  expo(messages: Array<{ to: string; title: string; body: string; data: { url?: string } }>): Promise<
    Array<{ status: 'ok' | 'error'; details?: { error?: string } }>
  >
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export const defaultPushTransport: PushTransport = {
  async webPush(device, payload, config) {
    try {
      const res = await webpush.sendNotification(
        { endpoint: device.token, keys: { p256dh: device.p256dh, auth: device.auth } },
        payload,
        {
          vapidDetails: config,
          TTL: 24 * 60 * 60,
          timeout: 10_000,
        },
      )
      return res.statusCode
    } catch (e) {
      // WebPushError carries the push service's status (404/410 = gone, 403 = wrong VAPID key).
      if (e && typeof e === 'object' && 'statusCode' in e) return Number((e as { statusCode: number }).statusCode)
      throw e
    }
  },
  async expo(messages) {
    const token = process.env.EXPO_PUSH_ACCESS_TOKEN?.trim()
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(messages.map((m) => ({ ...m, sound: 'default' }))),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Expo push failed (${res.status})`)
    const json = (await res.json()) as { data?: Array<{ status: 'ok' | 'error'; details?: { error?: string } }> }
    return json.data ?? []
  },
}

let activeTransport: PushTransport = defaultPushTransport

/** Tests swap how messages leave the server; `null` restores the real one. */
export function usePushTransport(next: PushTransport | null) {
  activeTransport = next ?? defaultPushTransport
}

/**
 * Send to every device of one user. Devices the push service reports as gone (404/410, or Expo's
 * DeviceNotRegistered) are removed. Inactive users get nothing.
 */
export async function sendPushToUser(
  tenantId: string,
  userId: string,
  message: PushMessage,
  transport: PushTransport = activeTransport,
): Promise<{ devices: number; sent: number; failed: number; removed: number }> {
  const result = { devices: 0, sent: 0, failed: 0, removed: 0 }
  const user = await authDb.user.findFirst({ where: { id: userId, tenantId, isActive: true }, select: { id: true } })
  if (!user) return result

  const config = webPushConfig()
  const devices = await notificationDb.pushDevice.findMany({ where: { tenantId, userId } })
  result.devices = devices.length
  const delivered: string[] = []
  const gone: string[] = []

  const payload = JSON.stringify(message)
  for (const device of devices.filter((d) => d.kind === 'webpush')) {
    // Checked again at send time: rows saved before a rule change, or written some other way.
    if (!config || !device.p256dh || !device.auth || !isAllowedWebPushEndpoint(device.token)) continue
    try {
      const status = await transport.webPush({ token: device.token, p256dh: device.p256dh, auth: device.auth }, payload, config)
      if (status >= 200 && status < 300) delivered.push(device.id)
      else if (status === 404 || status === 410) gone.push(device.id)
      else {
        result.failed++
        console.error(`[push] web push to device ${device.id} returned ${status}`)
      }
    } catch (e) {
      result.failed++
      console.error(`[push] web push to device ${device.id} failed:`, e instanceof Error ? e.message : e)
    }
  }

  const expoDevices = devices.filter((d) => d.kind === 'expo')
  if (expoDevices.length > 0) {
    try {
      const tickets = await transport.expo(
        expoDevices.map((d) => ({ to: d.token, title: message.title, body: message.body, data: { url: message.url } })),
      )
      expoDevices.forEach((device, i) => {
        const ticket = tickets[i]
        if (ticket?.status === 'ok') delivered.push(device.id)
        else if (ticket?.details?.error === 'DeviceNotRegistered') gone.push(device.id)
        else result.failed++
      })
    } catch (e) {
      result.failed += expoDevices.length
      console.error('[push] Expo push failed:', e instanceof Error ? e.message : e)
    }
  }

  if (delivered.length > 0) {
    await notificationDb.pushDevice.updateMany({ where: { id: { in: delivered } }, data: { lastSentAt: new Date() } })
  }
  if (gone.length > 0) await notificationDb.pushDevice.deleteMany({ where: { id: { in: gone } } })
  result.sent = delivered.length
  result.removed = gone.length
  return result
}
