import * as push from '../push'
import { ApiError, requireSession } from './common'

/**
 * Push opt-in for the signed-in user's own devices:
 * - GET    /push/config          the VAPID public key a browser subscribes with (null = not set up)
 * - POST   /push/devices         register this device ({kind:'webpush', endpoint, keys} or {kind:'expo', token})
 * - POST   /push/devices/remove  unregister one of the user's own devices ({token} — the endpoint for web push)
 * - POST   /push/test            send a test alert to the user's devices
 */
export async function routePush(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg[1] === 'config' && seg.length === 2 && method === 'GET') {
    return Response.json({ webPushPublicKey: push.webPushConfig()?.publicKey ?? null, expo: true })
  }
  if (seg[1] === 'devices' && seg.length === 2 && method === 'POST') {
    const body = (await req.json()) as push.RegisterPushDeviceInput
    return Response.json(await push.registerPushDevice(session.tenantId, session.userId, body), { status: 201 })
  }
  if (seg[1] === 'devices' && seg[2] === 'remove' && seg.length === 3 && method === 'POST') {
    const body = (await req.json()) as { token?: string }
    if (typeof body.token !== 'string' || !body.token) throw new ApiError(400, 'token required')
    return Response.json(await push.unregisterPushDevice(session.tenantId, session.userId, body.token))
  }
  if (seg[1] === 'test' && seg.length === 2 && method === 'POST') {
    const result = await push.sendPushToUser(session.tenantId, session.userId, {
      title: 'Notifications are on',
      body: 'You will get alerts like "your order shipped" on this device.',
      url: '/account',
      tag: 'push.test',
    })
    if (result.devices === 0) throw new ApiError(400, 'No push devices registered for your account')
    // This button is how a deploy is checked, so "nothing arrived" must not look like success.
    if (result.sent === 0) throw new ApiError(502, 'The test notification was not delivered to any device. Check the server logs.')
    return Response.json(result)
  }
  throw new ApiError(404, 'Push route not found')
}
