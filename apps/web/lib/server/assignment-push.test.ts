import assert from 'node:assert/strict'
import { createECDH, randomBytes, randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { pickTaskAssignedMessage, routeAssignedMessage, shouldNotify } from './assignment-push'
import { loginUser } from './auth'
import { authDb, dispatchDb, notificationDb, tenantDb, wmsDb } from './db'
import { registerPushDevice, usePushTransport, type PushTransport } from './push'

const PASSWORD = 'assign-push-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const uid: Record<string, string> = {}
const sent: Array<{ to: string; payload: Record<string, string> }> = []

const transport: PushTransport = {
  async webPush(device, payload) {
    sent.push({ to: device.token, payload: JSON.parse(payload) })
    return 201
  },
  async expo(messages) {
    return messages.map(() => ({ status: 'ok' as const }))
  },
}

async function makeUser(key: string, role: 'DRIVER' | 'WAREHOUSE_STAFF' | 'MANAGER') {
  const email = `${key}-${randomUUID().slice(0, 6)}@example.test`
  const user = await authDb.user.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: key, lastName: 'U', role, permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
  uid[key] = user.id
  tok[key] = (await loginUser(email, PASSWORD)).accessToken
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  await registerPushDevice(tenantId, user.id, {
    kind: 'webpush',
    endpoint: `https://fcm.googleapis.com/fcm/send/${key}-${randomUUID()}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  })
}

const call = (key: string, method: string, path: string, body?: unknown) =>
  handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${tok[key]}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )

/** The push is sent after the response, so wait for it to land. */
async function settle(n: number) {
  for (let i = 0; i < 50 && sent.length < n; i++) await new Promise((r) => setTimeout(r, 20))
  await new Promise((r) => setTimeout(r, 60))
}

before(async () => {
  process.env.VAPID_PUBLIC_KEY = 'test-public'
  process.env.VAPID_PRIVATE_KEY = 'test-private'
  process.env.VAPID_SUBJECT = 'mailto:ops@example.test'
  usePushTransport(transport)
  await authDb.tenant.create({ data: { id: tenantId, name: 'A', slug: `a-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `a-${tenantId.slice(-8)}`, displayName: 'A', settings: {}, metadata: {} },
  })
  await makeUser('driver', 'DRIVER')
  await makeUser('picker', 'WAREHOUSE_STAFF')
  await makeUser('m', 'MANAGER')
})

after(async () => {
  usePushTransport(null)
  await dispatchDb.deliveryRoute.deleteMany({ where: { tenantId } })
  await wmsDb.fulfillmentTask.deleteMany({ where: { tenantId } })
  await notificationDb.pushDevice.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

test('messages name the work and open the right screen', () => {
  const r = routeAssignedMessage({ id: 'abcdef123456', name: 'Tampa AM', stopCount: 3 })
  assert.equal(r.body, 'Tampa AM · 3 stops')
  assert.equal(r.url, '/m/delivery/route/abcdef123456')
  assert.equal(routeAssignedMessage({ id: 'abcdef123456', stopCount: 1 }).body, 'Route 123456 · 1 stop')
  const t = pickTaskAssignedMessage({ id: 't1', orderId: 'order-12345678', priority: 'URGENT', lineCount: 2 })
  assert.equal(t.title, 'Urgent pick task')
  assert.equal(t.body, 'Order #12345678 · 2 lines')
  assert.equal(t.url, '/m/warehouse/task/t1')
  assert.equal(pickTaskAssignedMessage({ id: 't1', orderId: 'o' }).title, 'New pick task')
})

test('only a new person other than the one acting is alerted', () => {
  assert.equal(shouldNotify(null, 'u1', 'm'), true)
  assert.equal(shouldNotify('u0', 'u1', 'm'), true)
  assert.equal(shouldNotify('u1', 'u1', 'm'), false)
  assert.equal(shouldNotify('u0', 'm', 'm'), false)
  assert.equal(shouldNotify('u0', null, 'm'), false)
})

test('assigning a pick task alerts the picker once, not on a repeat or a self-assign', async () => {
  sent.length = 0
  const task = await wmsDb.fulfillmentTask.create({
    data: { tenantId, orderId: `o-${randomUUID()}`, correlationId: 'c', warehouseId: 'w1', warehouseCode: 'W1', status: 'PENDING', pickLines: { create: [{ skuId: 's', warehouseId: 'w1', quantity: 1 }] } },
  })
  assert.equal((await call('m', 'PATCH', `/wms/tasks/${task.id}/assign`, { userId: uid.picker })).status, 200)
  await settle(1)
  assert.equal(sent.length, 1)
  assert.match(sent[0].to, /picker-/)
  assert.equal(sent[0].payload.url, `/m/warehouse/task/${task.id}`)

  assert.equal((await call('m', 'PATCH', `/wms/tasks/${task.id}/assign`, { userId: uid.picker })).status, 200)
  assert.equal((await call('m', 'PATCH', `/wms/tasks/${task.id}/assign`, { userId: uid.m })).status, 200)
  await settle(2)
  assert.equal(sent.length, 1)
})

test('assigning a driver to a route alerts that driver and opens the route', async () => {
  sent.length = 0
  const route = await dispatchDb.deliveryRoute.create({
    data: { tenantId, status: 'PLANNED', name: 'Tampa AM', stops: { create: [{ sequence: 1, address: { line1: '1 Main St' } }] } },
  })
  assert.equal((await call('m', 'PATCH', `/routes/${route.id}/driver`, { driverId: uid.driver })).status, 200)
  await settle(1)
  assert.equal(sent.length, 1)
  assert.match(sent[0].to, /driver-/)
  assert.equal(sent[0].payload.body, 'Tampa AM · 1 stop')
  assert.equal(sent[0].payload.url, `/m/delivery/route/${route.id}`)
})
