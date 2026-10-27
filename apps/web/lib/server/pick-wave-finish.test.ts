import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, tenantDb, wmsDb } from './db'

const PASSWORD = 'pick-wave-pass-1'
const tenantId = `t-${randomUUID()}`
const warehouseId = `wh-${randomUUID()}`
const userIds: string[] = []
let token = ''

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'Pick', slug: `pick-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `pick-${tenantId.slice(-8)}`, displayName: 'Pick', settings: {}, metadata: {} },
  })
  const email = `manager-${randomUUID().slice(0, 6)}@example.test`
  const user = await authDb.user.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: 'M', lastName: 'U', role: 'MANAGER', permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
  token = (await loginUser(email, PASSWORD)).accessToken
})

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await wmsDb.pickWave.deleteMany({ where: { tenantId } })
  await wmsDb.fulfillmentTask.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: tenantId } })
  await authDb.tenant.deleteMany({ where: { id: tenantId } })
})

async function call(method: string, path: string, body?: unknown) {
  const res = await handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  )
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function task() {
  return wmsDb.fulfillmentTask.create({
    data: {
      tenantId,
      orderId: `order-${randomUUID()}`,
      correlationId: randomUUID(),
      warehouseId,
      warehouseCode: 'MAIN',
      pickLines: { create: [{ skuId: `sku-${randomUUID()}`, warehouseId, quantity: 5 }] },
    },
  })
}

/** The HTTP method the admin Waves tab uses for a wave action. */
function clientWaveMethod(action: 'start' | 'complete') {
  const src = readFileSync(new URL('../../../client/src/pages/admin/warehouse/tabs/waves-tab.tsx', import.meta.url), 'utf8')
  const m = src.match(new RegExp(`api\\.(\\w+)\\(\`/pick-waves/\\$\\{id\\}/${action}\``))
  assert.ok(m, `waves-tab.tsx ${action} call not found`)
  return m[1].toUpperCase()
}

test('a wave started and completed from the admin Waves tab works, but only once its tasks are picked', async () => {
  const t = await task()
  const created = await call('POST', '/pick-waves', { warehouseId, taskIds: [t.id] })
  assert.equal(created.status, 201)
  const waveId = created.body.id as string

  const started = await call(clientWaveMethod('start'), `/pick-waves/${waveId}/start`)
  assert.equal(started.status, 200, JSON.stringify(started.body))
  assert.equal(started.body.status, 'IN_PROGRESS')
  assert.ok(started.body.startedAt, 'start time is recorded')
  assert.equal((await wmsDb.fulfillmentTask.findUniqueOrThrow({ where: { id: t.id } })).status, 'PICKING')

  const early = await call(clientWaveMethod('complete'), `/pick-waves/${waveId}/complete`)
  assert.equal(early.status, 409)
  assert.match(String(early.body.message), /1 task is not picked yet/)

  await wmsDb.pickLine.updateMany({ where: { taskId: t.id }, data: { status: 'PICKED', pickedQty: 5 } })
  const done = await call(clientWaveMethod('complete'), `/pick-waves/${waveId}/complete`)
  assert.equal(done.status, 200, JSON.stringify(done.body))
  assert.equal(done.body.status, 'COMPLETED')
  assert.ok(done.body.completedAt)
})

test('a fully picked task can be packed from the phone', async () => {
  const t = await task()
  await wmsDb.pickLine.updateMany({ where: { taskId: t.id }, data: { status: 'PICKED', pickedQty: 5 } })
  const res = await call('POST', `/wms/tasks/${t.id}/pack`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal((await wmsDb.fulfillmentTask.findUniqueOrThrow({ where: { id: t.id } })).status, 'PACKED')
})

test('a wave whose tasks no longer exist can still be closed', async () => {
  const t = await task()
  const waveId = (await call('POST', '/pick-waves', { warehouseId, taskIds: [t.id] })).body.id as string
  await wmsDb.fulfillmentTask.delete({ where: { id: t.id } })
  const res = await call('POST', `/pick-waves/${waveId}/complete`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.status, 'COMPLETED')
})
