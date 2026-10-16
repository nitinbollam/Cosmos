import assert from 'node:assert/strict'
import { createECDH, randomBytes, randomUUID } from 'node:crypto'
import { after, afterEach, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import webpush from 'web-push'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { portalUsersForCustomer, resolvePortalCustomerId } from './buyer-context'
import { authDb, crmDb, notificationDb, tenantDb } from './db'
import { notifyOrderShipped } from './notification-triggers'
import {
  isAllowedWebPushEndpoint,
  registerPushDevice,
  sendPushToUser,
  usePushTransport,
  type PushTransport,
} from './push'

const tenantId = `t-${randomUUID()}`
const otherTenantId = `t-${randomUUID()}`
const tenants = [tenantId, otherTenantId]
const SHARED_EMAIL = `shared-${randomUUID().slice(0, 8)}@example.test`

/** Keys shaped like a real browser subscription: a P-256 public key (65 bytes) and a 16-byte secret. */
function browserKeys() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }
}
const endpoint = () => `https://fcm.googleapis.com/fcm/send/${randomUUID()}`

/** Records what would have been sent; answers with `status` (or per-call overrides). */
function fakeTransport(status = 201) {
  const sent: Array<{ token: string; payload: Record<string, unknown> }> = []
  const transport: PushTransport = {
    async webPush(device, payload) {
      sent.push({ token: device.token, payload: JSON.parse(payload) })
      return status
    },
    async expo(messages) {
      return messages.map(() => ({ status: 'ok' as const }))
    },
  }
  return { sent, transport }
}

async function user(tenant: string, email: string, role: string, isActive = true) {
  return authDb.user.create({
    data: { tenantId: tenant, email, passwordHash: 'x', firstName: 'P', lastName: 'U', role: role as 'STAFF', permissions: [], isActive },
  })
}

const signedIn: string[] = []
let customerA = ''
let customerB = ''

before(async () => {
  process.env.VAPID_PUBLIC_KEY = 'test-public'
  process.env.VAPID_PRIVATE_KEY = 'test-private'
  process.env.VAPID_SUBJECT = 'mailto:ops@example.test'
  for (const id of tenants) {
    await authDb.tenant.create({ data: { id, name: 'Push', slug: `push-${id.slice(-8)}`, settings: {} } })
    await tenantDb.tenantOrganization.create({
      data: { id, slug: `push-${id.slice(-8)}`, displayName: 'Push', settings: {}, metadata: {} },
    })
  }
  // Two customers of one tenant share an email; the portal resolves that email to the first one.
  customerA = (await crmDb.customer.create({ data: { tenantId, name: 'A', email: SHARED_EMAIL } })).id
  customerB = (await crmDb.customer.create({ data: { tenantId, name: 'B', email: SHARED_EMAIL } })).id
})

afterEach(() => usePushTransport(null))

after(async () => {
  for (const key of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) delete process.env[key]
  await authDb.authSession.deleteMany({ where: { userId: { in: signedIn } } })
  await notificationDb.pushDevice.deleteMany({ where: { tenantId: { in: tenants } } })
  await notificationDb.notificationRequest.deleteMany({ where: { tenantId: { in: tenants } } })
  await crmDb.customer.deleteMany({ where: { tenantId: { in: tenants } } })
  await authDb.user.deleteMany({ where: { tenantId: { in: tenants } } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: { in: tenants } } })
  await authDb.tenant.deleteMany({ where: { id: { in: tenants } } })
})

test('only the buyer who signs in as the customer is targeted', async () => {
  const buyer = await user(tenantId, SHARED_EMAIL, 'STAFF')
  await user(otherTenantId, SHARED_EMAIL, 'STAFF') // same email, other tenant

  // Two customers share the email; the buyer signs in as whichever one the portal resolves.
  const signedInAs = await resolvePortalCustomerId(tenantId, SHARED_EMAIL)
  const other = signedInAs === customerA ? customerB : customerA
  assert.deepEqual((await portalUsersForCustomer(tenantId, signedInAs!)).map((u) => u.id), [buyer.id])
  assert.deepEqual(await portalUsersForCustomer(tenantId, other), [])

  // A staff account with a customer's email is not that customer's buyer.
  const staffEmail = `staff-${randomUUID().slice(0, 6)}@example.test`
  const staffCustomer = (await crmDb.customer.create({ data: { tenantId, name: 'S', email: staffEmail } })).id
  await user(tenantId, staffEmail, 'MANAGER')
  assert.deepEqual(await portalUsersForCustomer(tenantId, staffCustomer), [])
})

test('the real web-push library accepts our subscription and VAPID shapes', () => {
  const vapid = webpush.generateVAPIDKeys()
  const keys = browserKeys()
  const details = webpush.generateRequestDetails(
    { endpoint: endpoint(), keys },
    JSON.stringify({ title: 'T', body: 'B' }),
    { vapidDetails: { subject: 'mailto:ops@example.test', ...vapid }, TTL: 60 },
  )
  assert.equal(details.method, 'POST')
  assert.match(String(details.headers.Authorization), /^vapid t=.+, k=/)
  assert.equal(details.headers['Content-Encoding'], 'aes128gcm')
  assert.ok(details.body && details.body.length > 20, 'payload is encrypted into the body')
})

test('only browser push services are accepted as endpoints, with real-looking keys', async () => {
  const u = await user(tenantId, `reg-${randomUUID().slice(0, 6)}@example.test`, 'STAFF')
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evil.example/fcm.googleapis.com',
    'https://user:pw@fcm.googleapis.com/x',
    'https://169.254.169.254/latest/meta-data',
  ]) {
    assert.equal(isAllowedWebPushEndpoint(bad), false, bad)
    await assert.rejects(registerPushDevice(tenantId, u.id, { kind: 'webpush', endpoint: bad, keys: browserKeys() }), { status: 400 })
  }
  for (const good of [endpoint(), 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://wns2-bl2p.notify.windows.com/w/?token=x']) {
    assert.equal(isAllowedWebPushEndpoint(good), true, good)
  }
  await assert.rejects(
    registerPushDevice(tenantId, u.id, { kind: 'webpush', endpoint: endpoint(), keys: { p256dh: 'short', auth: 'x' } }),
    { status: 400 },
  )
  await assert.rejects(registerPushDevice(tenantId, u.id, { kind: 'expo', token: 'not-a-token' }), { status: 400 })
  await registerPushDevice(tenantId, u.id, { kind: 'expo', token: `ExponentPushToken[${randomUUID().slice(0, 22)}]` })
})

test('registering a device someone else registered moves it to the new user', async () => {
  const first = await user(tenantId, `first-${randomUUID().slice(0, 6)}@example.test`, 'STAFF')
  const second = await user(tenantId, `second-${randomUUID().slice(0, 6)}@example.test`, 'STAFF')
  const url = endpoint()
  await registerPushDevice(tenantId, first.id, { kind: 'webpush', endpoint: url, keys: browserKeys() })
  await registerPushDevice(tenantId, second.id, { kind: 'webpush', endpoint: url, keys: browserKeys() })
  const rows = await notificationDb.pushDevice.findMany({ where: { token: url } })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.userId, second.id)
})

test('gone devices are removed, other failures are kept, inactive users get nothing', async () => {
  const u = await user(tenantId, `send-${randomUUID().slice(0, 6)}@example.test`, 'STAFF')
  const ok = endpoint()
  const gone = endpoint()
  const forbidden = endpoint()
  for (const url of [ok, gone, forbidden]) await registerPushDevice(tenantId, u.id, { kind: 'webpush', endpoint: url, keys: browserKeys() })
  const transport: PushTransport = {
    async webPush(device) {
      return device.token === gone ? 410 : device.token === forbidden ? 403 : 201
    },
    async expo() {
      return []
    },
  }
  const result = await sendPushToUser(tenantId, u.id, { title: 'T', body: 'B' }, transport)
  assert.deepEqual(result, { devices: 3, sent: 1, failed: 1, removed: 1 })
  const left = (await notificationDb.pushDevice.findMany({ where: { userId: u.id } })).map((d) => d.token).sort()
  assert.deepEqual(left, [ok, forbidden].sort())

  const inactive = await user(tenantId, `off-${randomUUID().slice(0, 6)}@example.test`, 'STAFF', false)
  await registerPushDevice(tenantId, inactive.id, { kind: 'webpush', endpoint: endpoint(), keys: browserKeys() })
  const fake = fakeTransport()
  assert.equal((await sendPushToUser(tenantId, inactive.id, { title: 'T', body: 'B' }, fake.transport)).sent, 0)
  assert.equal(fake.sent.length, 0)
})

test('order shipped: pushed once to the customer\'s device, with no amounts', async () => {
  const email = `ship-${randomUUID().slice(0, 6)}@example.test`
  const customer = (await crmDb.customer.create({ data: { tenantId, name: 'Shipper', email } })).id
  const buyer = await user(tenantId, email, 'STAFF')
  const url = endpoint()
  await registerPushDevice(tenantId, buyer.id, { kind: 'webpush', endpoint: url, keys: browserKeys() })
  const fake = fakeTransport()
  usePushTransport(fake.transport)

  const orderId = `order-${randomUUID()}`
  await notifyOrderShipped(tenantId, orderId, customer)
  await notifyOrderShipped(tenantId, orderId, customer) // the event fires again: no second alert

  assert.equal(fake.sent.length, 1)
  const { payload } = fake.sent[0]!
  assert.equal(payload.title, 'Your order has shipped')
  assert.equal(payload.url, `/orders/${orderId}`)
  assert.equal(payload.tag, `order.shipped:${orderId}`)
  assert.doesNotMatch(String(payload.body), /\$|\d+\.\d{2}/)
})

test('order shipped: no push when order updates are off, and no record for users without a device', async () => {
  const email = `quiet-${randomUUID().slice(0, 6)}@example.test`
  const customer = (await crmDb.customer.create({ data: { tenantId, name: 'Quiet', email } })).id
  const buyer = await user(tenantId, email, 'STAFF')
  const fake = fakeTransport()
  usePushTransport(fake.transport)

  // No device: nothing is queued, so nothing shows up as a failed notification either.
  await notifyOrderShipped(tenantId, `order-${randomUUID()}`, customer)
  const pushRows = await notificationDb.notificationRequest.count({ where: { tenantId, channel: 'PUSH', recipient: buyer.id } })
  assert.equal(pushRows, 0)

  await registerPushDevice(tenantId, buyer.id, { kind: 'webpush', endpoint: endpoint(), keys: browserKeys() })
  await tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: { settings: { customerNotificationPrefs: { [customer]: { orderUpdates: false } } } },
  })
  try {
    await notifyOrderShipped(tenantId, `order-${randomUUID()}`, customer)
    assert.equal(fake.sent.length, 0)
  } finally {
    await tenantDb.tenantOrganization.update({ where: { id: tenantId }, data: { settings: {} } })
  }
})

test('"Send a test" fails loudly when nothing was delivered', async () => {
  const email = `test-btn-${randomUUID().slice(0, 6)}@example.test`
  const u = await authDb.user.create({
    data: {
      tenantId, email, passwordHash: await bcrypt.hash('push-test-pass-1', 4), firstName: 'T', lastName: 'B',
      role: 'STAFF', permissions: [], emailVerifiedAt: new Date(),
    },
  })
  signedIn.push(u.id)
  const token = (await loginUser(email, 'push-test-pass-1')).accessToken
  await registerPushDevice(tenantId, u.id, { kind: 'webpush', endpoint: endpoint(), keys: browserKeys() })
  const pressTest = () =>
    handleApiRequest(new Request('http://localhost/api/v1/push/test', { method: 'POST', headers: { authorization: `Bearer ${token}` } }))

  // The push service rejects (e.g. VAPID keys don't match): the button must not say "sent".
  usePushTransport({ webPush: async () => 403, expo: async () => [] })
  assert.equal((await pressTest()).status, 502)

  usePushTransport(fakeTransport(201).transport)
  const ok = await pressTest()
  assert.equal(ok.status, 200)
  assert.equal(((await ok.json()) as { sent: number }).sent, 1)
})
