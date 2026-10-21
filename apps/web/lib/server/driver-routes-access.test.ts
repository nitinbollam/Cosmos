import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, dispatchDb, orderDb, tenantDb } from './db'

const PASSWORD = 'driver-scope-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
let tokenA = ''
let tokenB = ''
let tokenManager = ''
let idA = ''
let idB = ''
const ids: Record<string, { route: string; stop: string }> = {}

async function makeUser(role: 'DRIVER' | 'MANAGER') {
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`
  const user = await authDb.user.create({
    data: {
      tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: role, lastName: 'U', role,
      permissions: [], emailVerifiedAt: new Date(),
    },
  })
  userIds.push(user.id)
  return { id: user.id, token: (await loginUser(email, PASSWORD)).accessToken }
}

async function makeRoute(key: string, driverId: string | null, status: 'PLANNED' | 'ASSIGNED' | 'COMPLETED') {
  const order = await orderDb.order.create({
    data: { tenantId, customerId: 'c', channel: 'API', totalAmount: 10, paymentMethod: 'NET_TERMS', status: 'SHIPPED' },
  })
  const route = await dispatchDb.deliveryRoute.create({
    data: {
      tenantId, driverId, status, name: key,
      stops: { create: [{ sequence: 1, address: { orderId: order.id, customer: 'Acme', line1: '1 Main St' } }] },
    },
    include: { stops: true },
  })
  ids[key] = { route: route.id, stop: route.stops[0].id }
}

const call = (token: string, method: string, path: string, body?: unknown) =>
  handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'D', slug: `d-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `d-${tenantId.slice(-8)}`, displayName: 'D', settings: {}, metadata: {} },
  })
  const a = await makeUser('DRIVER')
  const b = await makeUser('DRIVER')
  const m = await makeUser('MANAGER')
  ;[tokenA, idA] = [a.token, a.id]
  ;[tokenB, idB] = [b.token, b.id]
  tokenManager = m.token
  await makeRoute('A', idA, 'ASSIGNED')
  await makeRoute('B', idB, 'ASSIGNED')
  await makeRoute('open', null, 'PLANNED')
  await makeRoute('doneA', idA, 'COMPLETED')
  await makeRoute('locA', idA, 'ASSIGNED')
})

after(async () => {
  await dispatchDb.deliveryRoute.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

test('a driver lists only their own routes; a manager lists all of them', async () => {
  const mine = (await (await call(tokenA, 'GET', '/routes')).json()) as Array<{ id: string }>
  assert.deepEqual(mine.map((r) => r.id).sort(), [ids.A.route, ids.doneA.route, ids.locA.route].sort())
  const active = (await (await call(tokenA, 'GET', '/routes?status=ASSIGNED,IN_PROGRESS')).json()) as Array<{ id: string }>
  assert.deepEqual(active.map((r) => r.id).sort(), [ids.A.route, ids.locA.route].sort())
  const all = (await (await call(tokenManager, 'GET', '/routes')).json()) as Array<{ id: string }>
  assert.equal(all.length, 5)
})

test('a driver cannot open another driver\'s or an unassigned route', async () => {
  assert.equal((await call(tokenA, 'GET', `/routes/${ids.A.route}`)).status, 200)
  assert.equal((await call(tokenA, 'GET', `/routes/${ids.B.route}`)).status, 404)
  assert.equal((await call(tokenA, 'GET', `/routes/${ids.open.route}`)).status, 404)
  assert.equal((await call(tokenManager, 'GET', `/routes/${ids.B.route}`)).status, 200)
})

test('a driver cannot record outcomes on another driver\'s stops', async () => {
  const res = await call(tokenA, 'POST', `/routes/${ids.B.route}/stops/${ids.B.stop}/failed`, { reason: 'Closed' })
  assert.equal(res.status, 404)
  const pod = await call(tokenA, 'POST', `/dispatch/stops/${ids.B.stop}/pod`, { routeId: ids.B.route })
  assert.equal(pod.status, 404)
  assert.equal((await dispatchDb.routeStop.findUniqueOrThrow({ where: { id: ids.B.stop } })).status, 'PENDING')
})

test('a driver can record an outcome on their own stop', async () => {
  const res = await call(tokenA, 'POST', `/routes/${ids.A.route}/stops/${ids.A.stop}/failed`, { reason: 'Store closed' })
  assert.equal(res.status, 200)
  assert.equal((await dispatchDb.routeStop.findUniqueOrThrow({ where: { id: ids.A.stop } })).status, 'FAILED')
})

test('a driver cannot plan, assign, or list shipped orders', async () => {
  assert.equal((await call(tokenA, 'POST', '/routes', { name: 'x', stops: [] })).status, 403)
  assert.equal((await call(tokenA, 'PATCH', `/routes/${ids.open.route}/driver`, { driverId: idA })).status, 403)
  assert.equal((await call(tokenA, 'DELETE', `/routes/${ids.B.route}/driver`)).status, 403)
  assert.equal((await call(tokenA, 'GET', '/routes/shipped-orders')).status, 403)
  assert.equal((await dispatchDb.deliveryRoute.findUniqueOrThrow({ where: { id: ids.open.route } })).driverId, null)
})

test('location pings are stored for the assigned driver and rejected otherwise', async () => {
  const fix = { routeId: ids.locA.route, lat: 27.9506, lng: -82.4572 }
  assert.equal((await call(tokenA, 'POST', '/dispatch/driver/location', fix)).status, 200)
  const stored = await dispatchDb.deliveryRoute.findUniqueOrThrow({ where: { id: ids.locA.route } })
  assert.equal(stored.lastKnownLat, 27.9506)
  assert.equal(stored.lastKnownLng, -82.4572)
  assert.ok(stored.lastKnownAt)

  assert.equal((await call(tokenB, 'POST', '/dispatch/driver/location', fix)).status, 403)
  assert.equal((await call(tokenA, 'POST', '/dispatch/driver/location', { ...fix, lat: 0, lng: 0 })).status, 400)
  assert.equal((await call(tokenA, 'POST', '/dispatch/driver/location', { lat: 27.9, lng: -82.4 })).status, 400)
  assert.equal((await call(tokenA, 'POST', '/dispatch/driver/location', { ...fix, routeId: ids.doneA.route })).status, 409)
  const untouched = await dispatchDb.deliveryRoute.findUniqueOrThrow({ where: { id: ids.B.route } })
  assert.equal(untouched.lastKnownLat, null)
})
