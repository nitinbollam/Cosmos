import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { assigneeProblem, PICKER_RULE, ROUTE_DRIVER_RULE, VAN_DRIVER_RULE } from './assignee-rules'
import { loginUser } from './auth'
import { authDb, dispatchDb, inventoryDb, tenantDb, wmsDb } from './db'

const T = 'tenant-a'
const person = (role: string, extra: Partial<{ isActive: boolean; tenantId: string }> = {}) => ({
  tenantId: T,
  role,
  isActive: true,
  firstName: 'Alex',
  lastName: 'Buyer',
  email: 'alex@example.test',
  ...extra,
})

test('assigneeProblem accepts an active user with an allowed role', () => {
  assert.equal(assigneeProblem(person('DRIVER'), T, ROUTE_DRIVER_RULE), null)
  assert.equal(assigneeProblem(person('DRIVER'), T, VAN_DRIVER_RULE), null)
  assert.equal(assigneeProblem(person('WAREHOUSE_STAFF'), T, PICKER_RULE), null)
})

test('assigneeProblem refuses a missing user and another company’s user with the same message', () => {
  const missing = assigneeProblem(null, T, ROUTE_DRIVER_RULE)
  assert.equal(missing, 'That user was not found in this company')
  assert.equal(assigneeProblem(person('DRIVER', { tenantId: 'tenant-b' }), T, ROUTE_DRIVER_RULE), missing)
})

test('assigneeProblem refuses a deactivated user', () => {
  assert.equal(
    assigneeProblem(person('DRIVER', { isActive: false }), T, ROUTE_DRIVER_RULE),
    "Alex Buyer is deactivated and can't be assigned a route",
  )
})

test('assigneeProblem refuses the wrong role and names it in plain words', () => {
  assert.equal(
    assigneeProblem(person('STAFF'), T, ROUTE_DRIVER_RULE),
    'Alex Buyer is a customer account. Only drivers can be assigned a route',
  )
  for (const role of ['WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SALES_REP', 'ACCOUNTANT', 'VIEWER']) {
    assert.match(assigneeProblem(person(role), T, ROUTE_DRIVER_RULE) ?? '', /Only drivers can be assigned a route$/, role)
  }
  assert.equal(
    assigneeProblem(person('SALES_REP'), T, PICKER_RULE),
    'Alex Buyer is a sales rep. Only warehouse staff can be assigned a pick task',
  )
  for (const role of ['MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN', 'DRIVER', 'STAFF']) {
    assert.match(assigneeProblem(person(role), T, PICKER_RULE) ?? '', /Only warehouse staff can be assigned a pick task$/, role)
  }
  assert.match(assigneeProblem(person('MANAGER'), T, VAN_DRIVER_RULE) ?? '', /Only drivers can be assigned a van$/)
})

test('assigneeProblem falls back to the email when the user has no name', () => {
  const noName = { ...person('STAFF'), firstName: null, lastName: null }
  assert.match(assigneeProblem(noName, T, ROUTE_DRIVER_RULE) ?? '', /^alex@example\.test is a customer account/)
})

// ── Through the API ──────────────────────────────────────────────────────────

const PASSWORD = 'assignee-rules-test-pass-1'
const tenantId = `t-${randomUUID()}`
const otherTenantId = `t-${randomUUID()}`
const userIds: string[] = []
const uid: Record<string, string> = {}
let managerToken = ''

async function makeUser(key: string, role: string, opts: { tenant?: string; isActive?: boolean } = {}) {
  const email = `${key}-${randomUUID().slice(0, 6)}@example.test`
  const user = await authDb.user.create({
    data: {
      tenantId: opts.tenant ?? tenantId,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      firstName: key,
      lastName: 'U',
      role: role as never,
      permissions: [],
      isActive: opts.isActive ?? true,
      emailVerifiedAt: new Date(),
    },
  })
  userIds.push(user.id)
  uid[key] = user.id
  return email
}

const call = (method: string, path: string, body?: unknown) =>
  handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${managerToken}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )

before(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await authDb.tenant.create({ data: { id, name: id, slug: `s-${id.slice(-8)}`, settings: {} } })
    await tenantDb.tenantOrganization.create({
      data: { id, slug: `s-${id.slice(-8)}`, displayName: id, settings: {}, metadata: {} },
    })
  }
  const managerEmail = await makeUser('manager', 'MANAGER')
  managerToken = (await loginUser(managerEmail, PASSWORD)).accessToken
  await makeUser('driver', 'DRIVER')
  await makeUser('oldDriver', 'DRIVER', { isActive: false })
  await makeUser('otherDriver', 'DRIVER', { tenant: otherTenantId })
  await makeUser('buyer', 'STAFF')
  await makeUser('picker', 'WAREHOUSE_STAFF')
  await makeUser('rep', 'SALES_REP')
})

after(async () => {
  await dispatchDb.deliveryRoute.deleteMany({ where: { tenantId } })
  await wmsDb.fulfillmentTask.deleteMany({ where: { tenantId } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  for (const id of [tenantId, otherTenantId]) {
    await tenantDb.tenantOrganization.delete({ where: { id } }).catch(() => undefined)
    await authDb.tenant.delete({ where: { id } }).catch(() => undefined)
  }
})

test('a route only takes an active driver from the same company', async () => {
  const route = await dispatchDb.deliveryRoute.create({
    data: { tenantId, status: 'PLANNED', name: 'Post St', stops: { create: [{ sequence: 1, address: { line1: '1 Main St' } }] } },
  })
  const refused: Array<[unknown, RegExp]> = [
    ['FAKE-USER-123', /not found in this company/],
    [uid.otherDriver, /not found in this company/],
    [uid.buyer, /customer account\. Only drivers/],
    [uid.picker, /warehouse staff\. Only drivers/],
    [uid.manager, /a manager\. Only drivers/],
    [uid.oldDriver, /deactivated/],
    ['   ', /driverId required/],
    [42, /driverId required/],
  ]
  for (const [driverId, message] of refused) {
    const res = await call('PATCH', `/routes/${route.id}/driver`, { driverId })
    assert.equal(res.status, 400, String(driverId))
    assert.match(((await res.json()) as { message: string }).message, message)
  }
  const unchanged = await dispatchDb.deliveryRoute.findUniqueOrThrow({ where: { id: route.id } })
  assert.equal(unchanged.driverId, null)
  assert.equal(unchanged.status, 'PLANNED')

  const ok = await call('PATCH', `/routes/${route.id}/driver`, { driverId: ` ${uid.driver} ` })
  assert.equal(ok.status, 200)
  const saved = await dispatchDb.deliveryRoute.findUniqueOrThrow({ where: { id: route.id } })
  assert.equal(saved.driverId, uid.driver)
  assert.equal(saved.status, 'ASSIGNED')
})

test('a pick task only takes warehouse staff; blank or null unassigns', async () => {
  const task = await wmsDb.fulfillmentTask.create({
    data: { tenantId, orderId: `o-${randomUUID()}`, correlationId: 'c', warehouseId: 'w1', warehouseCode: 'W1', status: 'PENDING', pickLines: { create: [{ skuId: 's', warehouseId: 'w1', quantity: 1 }] } },
  })
  for (const [userId, message] of [
    ['FAKE-USER-123', /not found in this company/],
    [uid.rep, /a sales rep\. Only warehouse staff can/],
    [uid.driver, /a driver\. Only warehouse staff can/],
    [uid.manager, /a manager\. Only warehouse staff can/],
    [uid.buyer, /customer account/],
    [7, /userId must be a string or null/],
  ] as Array<[unknown, RegExp]>) {
    const res = await call('PATCH', `/fulfillment/tasks/${task.id}/assign`, { userId })
    assert.equal(res.status, 400, String(userId))
    assert.match(((await res.json()) as { message: string }).message, message)
  }
  assert.equal((await wmsDb.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).assignedUserId, null)

  assert.equal((await call('PATCH', `/wms/tasks/${task.id}/assign`, { userId: uid.picker })).status, 200)
  assert.equal((await wmsDb.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).assignedUserId, uid.picker)
  assert.equal((await call('PATCH', `/wms/tasks/${task.id}/assign`, { userId: '' })).status, 200)
  assert.equal((await wmsDb.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).assignedUserId, null)
  assert.equal((await call('PATCH', `/wms/tasks/${task.id}/assign`, { userId: uid.picker })).status, 200)
  assert.equal((await call('PATCH', `/wms/tasks/${task.id}/assign`, { userId: null })).status, 200)
  assert.equal((await wmsDb.fulfillmentTask.findUniqueOrThrow({ where: { id: task.id } })).assignedUserId, null)
})

test('a van only takes an active driver from the same company', async () => {
  const van = (driverId: string, code: string) => ({ name: `Van ${code}`, code, driverId, stateCode: 'OK' })
  for (const [driverId, message] of [
    ['FAKE-USER-123', /not found in this company/],
    [uid.otherDriver, /not found in this company/],
    [uid.picker, /Only drivers can be assigned a van/],
    [uid.oldDriver, /deactivated/],
  ] as Array<[string, RegExp]>) {
    const res = await call('POST', '/vans', van(driverId, `V${randomUUID().slice(0, 4)}`))
    assert.equal(res.status, 400, driverId)
    assert.match(((await res.json()) as { message: string }).message, message)
  }
  assert.equal(await inventoryDb.warehouse.count({ where: { tenantId, kind: 'VEHICLE' } }), 0)
  assert.equal((await call('POST', '/vans', van(uid.driver, `V${randomUUID().slice(0, 4)}`))).status, 201)
})
