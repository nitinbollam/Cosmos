import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, inventoryDb, tenantDb, wmsDb } from './db'

const PASSWORD = 'pick-tasks-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const uid: Record<string, string> = {}
let skuA = ''
let skuB = ''

async function makeUser(key: string, role: 'WAREHOUSE_STAFF' | 'MANAGER') {
  const email = `${key}-${randomUUID().slice(0, 6)}@example.test`
  const user = await authDb.user.create({
    data: {
      tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: key, lastName: 'U', role,
      permissions: [], emailVerifiedAt: new Date(),
    },
  })
  userIds.push(user.id)
  uid[key] = user.id
  tok[key] = (await loginUser(email, PASSWORD)).accessToken
}

const call = (key: string, method: string, path: string, body?: unknown) =>
  handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${tok[key]}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )

async function makeTask(opts: { priority?: string; assignedUserId?: string | null; qty?: number } = {}) {
  return wmsDb.fulfillmentTask.create({
    data: {
      tenantId, orderId: `o-${randomUUID()}`, correlationId: 'c', warehouseId: 'w1', warehouseCode: 'W1',
      status: 'PENDING', priority: opts.priority ?? 'NORMAL', assignedUserId: opts.assignedUserId ?? null,
      pickLines: { create: [{ skuId: skuA, warehouseId: 'w1', quantity: opts.qty ?? 2 }, { skuId: skuB, warehouseId: 'w1', quantity: 1 }] },
    },
    include: { pickLines: true },
  })
}

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'P', slug: `p-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `p-${tenantId.slice(-8)}`, displayName: 'P', settings: {}, metadata: {} },
  })
  await makeUser('a', 'WAREHOUSE_STAFF')
  await makeUser('b', 'WAREHOUSE_STAFF')
  await makeUser('m', 'MANAGER')
  skuA = (await inventoryDb.sKU.create({ data: { tenantId, code: 'AAA', name: 'A', barcode: '0123456789012', category: 'x', cost: 1, price: 2, imageUrls: [], attributes: {} } })).id
  skuB = (await inventoryDb.sKU.create({ data: { tenantId, code: 'BBB', name: 'B', barcode: '0987654321098', category: 'x', cost: 1, price: 2, imageUrls: [], attributes: {} } })).id
})

after(async () => {
  await wmsDb.fulfillmentTask.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

test('the list can show my tasks, free tasks, or all, with urgent first', async () => {
  await wmsDb.fulfillmentTask.deleteMany({ where: { tenantId } })
  const normal = await makeTask()
  const urgent = await makeTask({ priority: 'URGENT' })
  const mineA = await makeTask({ assignedUserId: uid.a })
  const theirs = await makeTask({ assignedUserId: uid.b })
  const ids = async (q: string) => ((await (await call('a', 'GET', `/wms/tasks?${q}`)).json()) as Array<{ id: string }>).map((t) => t.id)
  assert.deepEqual(await ids('assigned=mine'), [mineA.id])
  assert.deepEqual((await ids('assigned=unassigned')).sort(), [normal.id, urgent.id].sort())
  assert.equal((await ids('assigned=unassigned'))[0], urgent.id)
  assert.equal((await ids('')).length, 4)
  assert.ok((await ids('assigned=mine')).every((id) => id !== theirs.id))
})

test('picking a line works on the path the app uses, and only the holder can do it', async () => {
  const task = await makeTask({ assignedUserId: uid.a })
  const line = task.pickLines.find((l) => l.skuId === skuA)!
  const path = `/wms/tasks/${task.id}/pick-lines/${line.id}`
  assert.equal((await call('b', 'PATCH', path, { pickedQty: 2 })).status, 403)
  const ok = await call('a', 'PATCH', path, { pickedQty: 2 })
  assert.equal(ok.status, 200)
  assert.equal((await wmsDb.pickLine.findUniqueOrThrow({ where: { id: line.id } })).pickedQty, 2)
  assert.equal((await call('m', 'PATCH', `/wms/tasks/${task.id}/pick-lines/${task.pickLines.find((l) => l.skuId === skuB)!.id}`, { pickedQty: 1 })).status, 200)
})

test('an unassigned task is claimed by the first person to pick from it', async () => {
  const task = await makeTask()
  const line = task.pickLines.find((l) => l.skuId === skuB)!
  assert.equal((await call('a', 'PATCH', `/wms/tasks/${task.id}/pick-lines/${line.id}`, { pickedQty: 1 })).status, 200)
  assert.equal((await wmsDb.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).assignedUserId, uid.a)
  assert.equal((await call('b', 'POST', `/wms/tasks/${task.id}/pick-all`, {})).status, 403)
})

test('scanning: the right item confirms the pick, the wrong one is refused', async () => {
  const task = await makeTask({ assignedUserId: uid.a })
  const line = task.pickLines.find((l) => l.skuId === skuA)!
  const path = `/wms/tasks/${task.id}/pick-lines/${line.id}`
  assert.equal((await call('a', 'PATCH', path, { pickedQty: 2, scanned: '0987654321098' })).status, 400)
  assert.equal((await call('a', 'PATCH', path, { pickedQty: 2, scanned: 'nonsense' })).status, 400)
  assert.equal((await wmsDb.pickLine.findUniqueOrThrow({ where: { id: line.id } })).pickedQty, 0)
  assert.equal((await call('a', 'PATCH', path, { pickedQty: 2, scanned: '0123456789012' })).status, 200)
  assert.equal((await wmsDb.pickLine.findUniqueOrThrow({ where: { id: line.id } })).status, 'PICKED')
})

test('a short pick is recorded through the short route', async () => {
  const task = await makeTask({ assignedUserId: uid.a })
  const line = task.pickLines[0]
  assert.equal((await call('a', 'POST', `/wms/tasks/${task.id}/pick-lines/${line.id}/short`, {})).status, 200)
  assert.equal((await wmsDb.pickLine.findUniqueOrThrow({ where: { id: line.id } })).status, 'SHORT')
})

test('claiming: free is yours, taken is refused, and two at once have one winner', async () => {
  const task = await makeTask()
  const both = await Promise.all([call('a', 'POST', `/wms/tasks/${task.id}/claim`, {}), call('b', 'POST', `/wms/tasks/${task.id}/claim`, {})])
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409])
  const holder = (await wmsDb.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).assignedUserId!
  const loser = holder === uid.a ? 'b' : 'a'
  assert.equal((await call(loser, 'POST', `/wms/tasks/${task.id}/claim`, {})).status, 409)
})

test('a task whose picker has gone quiet can be taken over; an active one cannot', async () => {
  const task = await makeTask({ assignedUserId: uid.a })
  assert.equal((await call('b', 'POST', `/wms/tasks/${task.id}/claim`, {})).status, 409)
  await wmsDb.fulfillmentTask.update({ where: { id: task.id }, data: { updatedAt: new Date(Date.now() - 45 * 60_000) } })
  assert.equal((await call('b', 'POST', `/wms/tasks/${task.id}/claim`, {})).status, 200)
  assert.equal((await wmsDb.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).assignedUserId, uid.b)
})

test('only a manager gives a task to someone else; the holder or a manager can release it', async () => {
  const task = await makeTask({ assignedUserId: uid.a })
  assert.equal((await call('b', 'PATCH', `/wms/tasks/${task.id}/assign`, { userId: uid.b })).status, 403)
  assert.equal((await call('m', 'PATCH', `/wms/tasks/${task.id}/assign`, { userId: uid.b })).status, 200)
  assert.equal((await call('a', 'POST', `/wms/tasks/${task.id}/release`, {})).status, 403)
  assert.equal((await call('b', 'POST', `/wms/tasks/${task.id}/release`, {})).status, 200)
  assert.equal((await wmsDb.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).assignedUserId, null)
})
