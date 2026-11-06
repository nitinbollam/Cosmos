import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ISOLATED_SKIP, assertIsolated, disposeIsolatedDatabases, prepareIsolatedDatabases } from './test-support/isolated-databases'
import { after, before, test as nodeTest, type TestOptions } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, orderDb, paymentDb, tenantDb } from './db'

type TestBody = () => void | Promise<void>
function test(name: string, fn: TestBody): void
function test(name: string, options: TestOptions, fn: TestBody): void
function test(name: string, optionsOrFn: TestOptions | TestBody, maybeFn?: TestBody) {
  if (typeof optionsOrFn === 'function') {
    nodeTest(name, { skip: ISOLATED_SKIP }, optionsOrFn)
    return
  }
  nodeTest(name, { ...optionsOrFn, skip: ISOLATED_SKIP || optionsOrFn.skip }, maybeFn!)
}

const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
const tokens: Record<string, string> = {}
const customers: Record<string, string> = {}
const userIdsByKey: Record<string, string> = {}

async function withPatched<T>(target: object, key: string, replacement: unknown, fn: () => Promise<T>) {
  const row = target as Record<string, unknown>
  const original = row[key]
  row[key] = replacement
  try {
    return await fn()
  } finally {
    row[key] = original
  }
}

async function makeUser(key: string, role: 'VIEWER' | 'MANAGER') {
  const email = `${key}-${randomUUID().slice(0, 8)}@cancellation.test`
  const user = await authDb.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await bcrypt.hash('cancel-test-password', 4),
      firstName: key,
      lastName: 'Test',
      role,
      permissions: [],
      emailVerifiedAt: new Date(),
    },
  })
  userIds.push(user.id)
  userIdsByKey[key] = user.id
  tokens[key] = (await loginUser(email, 'cancel-test-password')).accessToken
  if (role === 'VIEWER') {
    customers[key] = (
      await crmDb.customer.create({ data: { tenantId, name: `${key} Buyer`, email } })
    ).id
  }
}

const call = (key: string, method: string, path: string, body?: unknown) =>
  handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${tokens[key]}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )

async function orderFor(customerKey: string, status: string = 'PENDING') {
  return orderDb.order.create({
    data: {
      tenantId,
      customerId: customers[customerKey],
      channel: 'B2B_PORTAL',
      status: status as never,
      paymentMethod: 'CARD',
      totalAmount: '25.00',
      taxAmount: '0',
    },
  })
}

before(async () => {
  if (ISOLATED_SKIP) return
  assertIsolated()
  await prepareIsolatedDatabases([
    'auth', 'tenant', 'crm', 'order', 'payment', 'wms', 'inventory', 'ledger', 'notification',
  ])
  await authDb.tenant.create({ data: { id: tenantId, name: 'Cancel', slug: `cancel-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `cancel-${tenantId.slice(-8)}`, displayName: 'Cancel', settings: {}, metadata: {} },
  })
  await makeUser('buyer-a', 'VIEWER')
  await makeUser('buyer-b', 'VIEWER')
  await makeUser('manager', 'MANAGER')
})

after(async () => {
  if (ISOLATED_SKIP) return
  await tenantDb.approvalRequest.deleteMany({ where: { tenantId } })
  await orderDb.postingJob.deleteMany({ where: { tenantId } })
  await orderDb.orderSaga.deleteMany({ where: { tenantId } })
  await orderDb.invoice.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await paymentDb.paymentIntent.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
  await disposeIsolatedDatabases()
})

test('buyers can request cancellation only for their own eligible orders and duplicate posts reuse the pending request', async () => {
  const own = await orderFor('buyer-a')
  const other = await orderFor('buyer-b')

  const denied = await call('buyer-a', 'POST', `/orders/${other.id}/cancellation-requests`, { reason: 'Not mine' })
  assert.equal(denied.status, 404)

  const missingReason = await call('buyer-a', 'POST', `/orders/${own.id}/cancellation-requests`, { reason: '  ' })
  assert.equal(missingReason.status, 400)

  const first = await call('buyer-a', 'POST', `/orders/${own.id}/cancellation-requests`, { reason: 'Please cancel this order' })
  assert.equal(first.status, 201)
  const firstBody = (await first.json()) as { request: { id: string; status: string }; duplicate: boolean }
  assert.equal(firstBody.request.status, 'PENDING')
  assert.equal('reason' in firstBody.request, true)
  assert.equal('context' in firstBody.request, false)
  assert.equal('requestedBy' in firstBody.request, false)
  assert.equal('decidedBy' in firstBody.request, false)
  const fetched = await call('buyer-a', 'GET', `/orders/${own.id}/cancellation-requests`)
  const fetchedBody = (await fetched.json()) as { request: Record<string, unknown> }
  assert.deepEqual(Object.keys(fetchedBody.request).sort(), ['id', 'reason', 'rejectReason', 'status'])
  assert.equal(firstBody.duplicate, false)

  const second = await call('buyer-a', 'POST', `/orders/${own.id}/cancellation-requests`, { reason: 'Duplicate request' })
  assert.equal(second.status, 200)
  const secondBody = (await second.json()) as { request: { id: string }; duplicate: boolean }
  assert.equal(secondBody.request.id, firstBody.request.id)
  assert.equal(secondBody.duplicate, true)
  assert.equal(await tenantDb.approvalRequest.count({ where: { tenantId, subjectId: own.id } }), 1)

  const legacy = await call('buyer-a', 'POST', `/orders/${own.id}/cancel`, { reason: 'Bypass request' })
  assert.equal(legacy.status, 403)
})

test('buyers cannot request cancellation after packing or shipping', async () => {
  for (const status of ['PACKED', 'SHIPPED']) {
    const order = await orderFor('buyer-a', status)
    const res = await call('buyer-a', 'POST', `/orders/${order.id}/cancellation-requests`, { reason: 'Cancel please' })
    assert.equal(res.status, 400, status)
    const body = (await res.json()) as { message: string }
    if (status === 'SHIPPED') assert.match(body.message, /Return \/ Credit note/)
    assert.equal(await tenantDb.approvalRequest.count({ where: { tenantId, subjectId: order.id } }), 0)
  }
})

test('simultaneous requests for the same order leave one pending approval', async () => {
  const order = await orderFor('buyer-a')
  const [first, second] = await Promise.all([
    call('buyer-a', 'POST', `/orders/${order.id}/cancellation-requests`, { reason: 'Request one' }),
    call('buyer-a', 'POST', `/orders/${order.id}/cancellation-requests`, { reason: 'Request two' }),
  ])
  assert.ok([200, 201].includes(first.status))
  assert.ok([200, 201].includes(second.status))
  assert.equal(await tenantDb.approvalRequest.count({ where: { tenantId, subjectId: order.id, status: 'PENDING' } }), 1)
})

test('staff rejection leaves the order, invoice, and payment unchanged', async () => {
  const order = await orderFor('buyer-a')
  await orderDb.order.update({ where: { id: order.id }, data: { amountPaid: '25.00' } })
  const invoice = await orderDb.invoice.create({
    data: {
      tenantId,
      orderId: order.id,
      invoiceNumber: `INV-${randomUUID()}`,
      customerId: order.customerId,
      totalAmount: '25.00',
      subtotal: '25.00',
      taxAmount: '0',
      amountPaid: '25.00',
      status: 'PAID',
    },
  })
  const intent = await paymentDb.paymentIntent.create({
    data: {
      tenantId,
      orderId: order.id,
      amount: '25.00',
      capturedAmount: '25.00',
      paymentMethod: 'CARD',
      status: 'CAPTURED',
      customerId: order.customerId,
      correlationId: randomUUID(),
      metadata: {},
    },
  })
  const requested = await call('buyer-a', 'POST', `/orders/${order.id}/cancellation-requests`, { reason: 'Changed plans' })
  const { request } = (await requested.json()) as { request: { id: string } }
  const rejected = await call('manager', 'POST', `/approvals/${request.id}/decide`, { approve: false, rejectReason: 'Already preparing' })
  assert.equal(rejected.status, 200)
  assert.equal((await orderDb.order.findFirstOrThrow({ where: { id: order.id } })).status, 'PENDING')
  assert.equal((await orderDb.invoice.findFirstOrThrow({ where: { id: invoice.id } })).status, 'PAID')
  assert.equal((await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: intent.id } })).status, 'CAPTURED')
  assert.equal(Number((await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: intent.id } })).refundedAmount), 0)
})

test('approval rechecks packing eligibility and rejects without refunding after status advances', async () => {
  const order = await orderFor('buyer-a')
  await orderDb.order.update({ where: { id: order.id }, data: { amountPaid: '25.00' } })
  const intent = await paymentDb.paymentIntent.create({
    data: {
      tenantId,
      orderId: order.id,
      amount: '25.00',
      capturedAmount: '25.00',
      paymentMethod: 'CARD',
      status: 'CAPTURED',
      customerId: order.customerId,
      correlationId: randomUUID(),
      metadata: {},
    },
  })
  const requested = await call('buyer-a', 'POST', `/orders/${order.id}/cancellation-requests`, { reason: 'Changed plans' })
  const { request } = (await requested.json()) as { request: { id: string } }
  await orderDb.order.update({ where: { id: order.id }, data: { status: 'PACKED' } })

  const approved = await call('manager', 'POST', `/approvals/${request.id}/decide`, { approve: true })
  assert.equal(approved.status, 200)
  const decision = (await approved.json()) as { status: string; rejectReason: string | null }
  assert.equal(decision.status, 'REJECTED')
  assert.match(String(decision.rejectReason), /no longer eligible/)
  assert.equal((decision as { decidedBy?: string }).decidedBy, 'system')
  const audit = await tenantDb.auditEvent.findFirst({
    where: { tenantId, entityType: 'ApprovalRequest', entityId: request.id, action: 'approval.rejected' },
  })
  assert.equal(audit?.userId, 'system')
  const originalApprovalAudit = await tenantDb.auditEvent.findFirst({
    where: { tenantId, entityType: 'ApprovalRequest', entityId: request.id, action: 'approval.approved' },
  })
  assert.equal(originalApprovalAudit?.userId, userIdsByKey.manager)
  assert.equal((await orderDb.order.findFirstOrThrow({ where: { id: order.id } })).status, 'PACKED')
  assert.equal((await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: intent.id } })).status, 'CAPTURED')
  assert.equal(Number((await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: intent.id } })).refundedAmount), 0)
})

test('a failed approved cancellation remains retryable and cannot create a duplicate request', async () => {
  const order = await orderFor('buyer-a')
  const submitted = await call('buyer-a', 'POST', `/orders/${order.id}/cancellation-requests`, { reason: 'Please cancel' })
  const { request } = (await submitted.json()) as { request: { id: string } }
  const sagaModel = orderDb.orderSaga as unknown as Record<string, (...args: unknown[]) => unknown>
  const original = sagaModel.updateMany.bind(orderDb.orderSaga)
  let failOnce = true
  const failedApproval = await withPatched(
    orderDb.orderSaga,
    'updateMany',
    async (...args: unknown[]) => {
      const input = args[0] as { data?: { status?: string } }
      if (failOnce && input.data?.status === 'COMPENSATING') {
        failOnce = false
        throw new Error('injected cancellation failure')
      }
      return original(...args)
    },
    () => call('manager', 'POST', `/approvals/${request.id}/decide`, { approve: true }),
  )
  assert.equal(failedApproval.status, 500)
  assert.equal((await tenantDb.approvalRequest.findFirstOrThrow({ where: { id: request.id } })).status, 'APPROVED')

  const duplicate = await call('buyer-a', 'POST', `/orders/${order.id}/cancellation-requests`, { reason: 'Try again' })
  assert.equal(duplicate.status, 200)
  const duplicateBody = (await duplicate.json()) as { request: { id: string; status: string }; duplicate: boolean }
  assert.equal(duplicateBody.duplicate, true)
  assert.equal(duplicateBody.request.id, request.id)
  assert.equal(duplicateBody.request.status, 'APPROVED')
  assert.equal(await tenantDb.approvalRequest.count({ where: { tenantId, subjectId: order.id } }), 1)

  const retry = await call('manager', 'POST', `/approvals/${request.id}/decide`, { approve: true })
  assert.equal(retry.status, 200)
  assert.equal((await orderDb.order.findFirstOrThrow({ where: { id: order.id } })).status, 'CANCELLED')
})

test('staff approval cancels once; repeated approval does not duplicate cancellation effects', async () => {
  const order = await orderFor('buyer-a')
  await orderDb.order.update({ where: { id: order.id }, data: { amountPaid: '25.00' } })
  const intent = await paymentDb.paymentIntent.create({
    data: {
      tenantId,
      orderId: order.id,
      amount: '25.00',
      capturedAmount: '25.00',
      paymentMethod: 'CARD',
      status: 'CAPTURED',
      customerId: order.customerId,
      correlationId: randomUUID(),
      metadata: {},
    },
  })
  const requested = await call('buyer-a', 'POST', `/orders/${order.id}/cancellation-requests`, { reason: 'Duplicate payment' })
  const { request } = (await requested.json()) as { request: { id: string } }
  const first = await call('manager', 'POST', `/approvals/${request.id}/decide`, { approve: true })
  assert.equal(first.status, 200)
  assert.equal((await orderDb.order.findFirstOrThrow({ where: { id: order.id } })).status, 'CANCELLED')
  assert.equal(Number((await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: intent.id } })).refundedAmount), 25)

  const repeated = await call('manager', 'POST', `/approvals/${request.id}/decide`, { approve: true })
  assert.equal(repeated.status, 200)
  assert.equal(Number((await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: intent.id } })).refundedAmount), 25)
  assert.equal(await orderDb.orderSaga.count({ where: { orderId: order.id } }), 1)
})
