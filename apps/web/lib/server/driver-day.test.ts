import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, dispatchDb, orderDb, tenantDb } from './db'
import { podForDelivery } from './stop-outcome'

const PASSWORD = 'driver-day-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
let driver = { id: '', token: '' }
let other = { id: '', token: '' }
let manager = { id: '', token: '' }

async function makeUser(role: 'DRIVER' | 'MANAGER') {
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`
  const u = await authDb.user.create({
    data: {
      tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: role, lastName: 'U', role,
      permissions: [], emailVerifiedAt: new Date(),
    },
  })
  userIds.push(u.id)
  return { id: u.id, token: (await loginUser(email, PASSWORD)).accessToken }
}

async function makeStop(status: 'PENDING' | 'DELIVERED' = 'PENDING') {
  const order = await orderDb.order.create({
    data: {
      tenantId, customerId: 'c', channel: 'API', status: 'SHIPPED', paymentMethod: 'CASH',
      totalAmount: 100, taxAmount: 0,
      lineItems: { create: [{ skuId: 's1', warehouseId: 'w1', quantity: 10, unitPrice: 10 }] },
    },
  })
  const route = await dispatchDb.deliveryRoute.create({
    data: {
      tenantId, driverId: driver.id, status: 'ASSIGNED', name: 'r', scheduledFor: new Date(),
      stops: { create: [{ sequence: 1, status, address: { orderId: order.id, customer: 'Acme', line1: '1 Main St' } }] },
    },
    include: { stops: true },
  })
  return { orderId: order.id, routeId: route.id, stopId: route.stops[0].id }
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
  driver = await makeUser('DRIVER')
  other = await makeUser('DRIVER')
  manager = await makeUser('MANAGER')
})

after(async () => {
  await dispatchDb.deliveryRoute.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

test('cash taken at the door is applied to the order and recorded on the stop', async () => {
  const s = await makeStop()
  const res = await call(driver.token, 'POST', `/routes/${s.routeId}/stops/${s.stopId}/collect`, { amountCents: 6000, method: 'CASH' })
  assert.equal(res.status, 200)
  const order = await orderDb.order.findUniqueOrThrow({ where: { id: s.orderId } })
  assert.equal(Number(order.amountPaid), 60)
  const stop = await dispatchDb.routeStop.findUniqueOrThrow({ where: { id: s.stopId } })
  const pod = stop.pod as { collections: Array<{ amount: string; method: string }> }
  assert.equal(pod.collections.length, 1)
  assert.equal(pod.collections[0].amount, '60')
})

test('more than is owed, a cheque with no number, and another driver are all refused', async () => {
  const s = await makeStop()
  const path = `/routes/${s.routeId}/stops/${s.stopId}/collect`
  assert.equal((await call(driver.token, 'POST', path, { amountCents: 10001, method: 'CASH' })).status, 400)
  assert.equal((await call(driver.token, 'POST', path, { amountCents: 500, method: 'CHECK' })).status, 400)
  assert.equal((await call(other.token, 'POST', path, { amountCents: 500, method: 'CASH' })).status, 404)
  const order = await orderDb.order.findUniqueOrThrow({ where: { id: s.orderId } })
  assert.equal(Number(order.amountPaid ?? 0), 0)
})

test('collections on a stop survive delivery and a client cannot write or erase them', () => {
  const rec = { at: 'x', by: 'u', orderId: 'o', amount: '5', method: 'CASH' }
  const kept = podForDelivery({ collections: [rec] }, { signature: 's', collections: [] }) as Record<string, unknown>
  assert.deepEqual(kept.collections, [rec])
  assert.equal((podForDelivery({}, { collections: [rec] }) as Record<string, unknown>).collections, undefined)
})

test('the day report shows expected cash and flags a delivered cash order nobody collected', async () => {
  const collected = await makeStop('DELIVERED')
  await call(driver.token, 'POST', `/routes/${collected.routeId}/stops/${collected.stopId}/collect`, { amountCents: 10000, method: 'CASH' })
  const missed = await makeStop('DELIVERED')
  const date = new Date().toISOString().slice(0, 10)
  const res = await call(manager.token, 'GET', `/routes/driver-days?date=${date}`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { drivers: Array<{ driverId: string; expectedCashCents: number; uncollected: Array<{ orderId: string; owedCents: number }> }> }
  const row = body.drivers.find((d) => d.driverId === driver.id)!
  assert.ok(row.expectedCashCents >= 10000)
  assert.ok(row.uncollected.some((u) => u.orderId === missed.orderId && u.owedCents === 10000))
  assert.ok(!row.uncollected.some((u) => u.orderId === collected.orderId))
  assert.equal((await call(driver.token, 'GET', `/routes/driver-days?date=${date}`)).status, 403)
  assert.equal((await call(manager.token, 'GET', '/routes/driver-days?date=nope')).status, 400)
})
