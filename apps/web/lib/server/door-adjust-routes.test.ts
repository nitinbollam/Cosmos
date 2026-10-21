import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, dispatchDb, orderDb, tenantDb } from './db'
import { updateTenantWorkflowSettings } from './tenant-workflow-settings'

const PASSWORD = 'door-adjust-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
let tokenA = ''
let tokenB = ''
let tokenManager = ''
let idA = ''

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

/** A shipped order with 10 x $10 and 4 x $25, on its own route for driver `driverId`. */
async function makeStop(driverId: string) {
  const order = await orderDb.order.create({
    data: {
      tenantId, customerId: 'c', channel: 'API', status: 'SHIPPED', paymentMethod: 'NET_TERMS',
      totalAmount: 200, taxAmount: 0,
      lineItems: {
        create: [
          { skuId: 's1', warehouseId: 'w1', quantity: 10, unitPrice: 10 },
          { skuId: 's2', warehouseId: 'w1', quantity: 4, unitPrice: 25 },
        ],
      },
    },
    include: { lineItems: true },
  })
  const route = await dispatchDb.deliveryRoute.create({
    data: {
      tenantId, driverId, status: 'ASSIGNED', name: 'r',
      stops: { create: [{ sequence: 1, address: { orderId: order.id, customer: 'Acme', line1: '1 Main St' } }] },
    },
    include: { stops: true },
  })
  const [l1, l2] = [...order.lineItems].sort((a, b) => a.skuId.localeCompare(b.skuId))
  return { orderId: order.id, routeId: route.id, stopId: route.stops[0].id, l1: l1.id, l2: l2.id }
}

const call = (token: string, path: string, body: unknown) =>
  handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
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
  ;[tokenA, idA, tokenB, tokenManager] = [a.token, a.id, b.token, m.token]
})

after(async () => {
  await dispatchDb.deliveryRoute.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

test('half the consignment: the order, invoice and stop record all agree', async () => {
  const s = await makeStop(idA)
  const res = await call(tokenA, `/routes/${s.routeId}/stops/${s.stopId}/adjust`, {
    reason: 'Store only wanted half',
    lines: [{ lineItemId: s.l1, quantity: 5 }],
  })
  assert.equal(res.status, 200)
  const order = await orderDb.order.findUniqueOrThrow({
    where: { id: s.orderId },
    include: { lineItems: true, invoice: true },
  })
  assert.equal(Number(order.totalAmount), 150)
  assert.equal(Number(order.invoice!.totalAmount), 150)
  assert.equal(Number(order.invoice!.amountCredited), 50)
  assert.equal(order.lineItems.find((l) => l.id === s.l1)!.returnedQty, 5)
  assert.equal(order.status, 'SHIPPED')

  const stop = await dispatchDb.routeStop.findUniqueOrThrow({ where: { id: s.stopId } })
  const adj = (stop.pod as { adjustments: Array<{ by: string; reason: string; total: string }> }).adjustments
  assert.equal(adj.length, 1)
  assert.equal(adj[0].by, idA)
  assert.equal(adj[0].reason, 'Store only wanted half')
  assert.equal(Number(adj[0].total), 50)
})

test('the change is refused when it is invalid, for someone else\'s stop, or takes everything', async () => {
  const s = await makeStop(idA)
  const path = `/routes/${s.routeId}/stops/${s.stopId}/adjust`
  assert.equal((await call(tokenA, path, { reason: '', lines: [{ lineItemId: s.l1, quantity: 1 }] })).status, 400)
  assert.equal((await call(tokenA, path, { reason: 'x', lines: [{ lineItemId: s.l1, quantity: 11 }] })).status, 400)
  assert.equal((await call(tokenA, path, { reason: 'x', lines: [{ lineItemId: 'nope', quantity: 1 }] })).status, 400)
  assert.equal((await call(tokenB, path, { reason: 'x', lines: [{ lineItemId: s.l1, quantity: 1 }] })).status, 404)
  const all = await call(tokenA, path, {
    reason: 'Refused it all',
    lines: [{ lineItemId: s.l1, quantity: 10 }, { lineItemId: s.l2, quantity: 4 }],
  })
  assert.equal(all.status, 409)
  const order = await orderDb.order.findUniqueOrThrow({ where: { id: s.orderId } })
  assert.equal(Number(order.totalAmount), 200)
})

test('the same units cannot be taken off twice', async () => {
  const s = await makeStop(idA)
  const path = `/routes/${s.routeId}/stops/${s.stopId}/adjust`
  const body = { reason: 'Damaged', lines: [{ lineItemId: s.l1, quantity: 6 }] }
  assert.equal((await call(tokenA, path, body)).status, 200)
  assert.equal((await call(tokenA, path, body)).status, 400)
})

test('above the tenant limit a driver is stopped and a manager can make the change', async () => {
  await updateTenantWorkflowSettings(tenantId, { doorAdjustmentThreshold: 40 })
  const s = await makeStop(idA)
  const path = `/routes/${s.routeId}/stops/${s.stopId}/adjust`
  const body = { reason: 'Wanted less', lines: [{ lineItemId: s.l1, quantity: 5 }] }
  assert.equal((await call(tokenA, path, body)).status, 403)
  assert.equal((await call(tokenA, path, { ...body, lines: [{ lineItemId: s.l1, quantity: 4 }] })).status, 200)
  assert.equal((await call(tokenManager, path, { ...body, lines: [{ lineItemId: s.l2, quantity: 2 }] })).status, 200)
  await updateTenantWorkflowSettings(tenantId, { doorAdjustmentThreshold: 0 })
})

test('a stop that already has an outcome cannot be changed, and the adjustment survives delivery', async () => {
  const s = await makeStop(idA)
  const path = `/routes/${s.routeId}/stops/${s.stopId}/adjust`
  assert.equal((await call(tokenA, path, { reason: 'Short', lines: [{ lineItemId: s.l2, quantity: 1 }] })).status, 200)
  assert.equal((await call(tokenA, `/routes/${s.routeId}/stops/${s.stopId}/failed`, { reason: 'Closed' })).status, 200)
  assert.equal((await call(tokenA, path, { reason: 'More', lines: [{ lineItemId: s.l2, quantity: 1 }] })).status, 409)
  const stop = await dispatchDb.routeStop.findUniqueOrThrow({ where: { id: s.stopId } })
  const pod = stop.pod as { adjustments?: unknown[]; failure?: unknown }
  assert.equal(pod.adjustments?.length, 1)
  assert.ok(pod.failure)
})
