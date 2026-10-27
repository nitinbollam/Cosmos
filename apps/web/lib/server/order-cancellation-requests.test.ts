import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, orderDb, paymentDb, tenantDb } from './db'

const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
const tokens: Record<string, string> = {}
const customers: Record<string, string> = {}

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
  await authDb.tenant.create({ data: { id: tenantId, name: 'Cancel', slug: `cancel-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `cancel-${tenantId.slice(-8)}`, displayName: 'Cancel', settings: {}, metadata: {} },
  })
  await makeUser('buyer-a', 'VIEWER')
  await makeUser('buyer-b', 'VIEWER')
  await makeUser('manager', 'MANAGER')
})

after(async () => {
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
  assert.equal((await orderDb.order.findFirstOrThrow({ where: { id: order.id } })).status, 'PACKED')
  assert.equal((await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: intent.id } })).status, 'CAPTURED')
  assert.equal(Number((await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: intent.id } })).refundedAmount), 0)
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
