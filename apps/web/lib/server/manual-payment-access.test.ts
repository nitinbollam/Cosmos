import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, orderDb, paymentDb, tenantDb } from './db'

const PASSWORD = 'manual-pay-test-pass-1'
const tenantId = `t-${randomUUID()}`
const buyerEmail = `buyer-${randomUUID().slice(0, 6)}@example.test`
const userIds: string[] = []
let orderId = ''
let invoiceId = ''

async function login(role: 'STAFF' | 'ACCOUNTANT' | 'SALES_REP', email = `${role.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`) {
  const user = await authDb.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      firstName: role,
      lastName: 'U',
      role,
      permissions: [],
      emailVerifiedAt: new Date(),
    },
  })
  userIds.push(user.id)
  return (await loginUser(email, PASSWORD)).accessToken
}

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'Pay', slug: `pay-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `pay-${tenantId.slice(-8)}`, displayName: 'Pay', settings: {}, metadata: {} },
  })
  // The buyer's account is linked to this customer by email, as in the portal.
  const customer = await crmDb.customer.create({ data: { tenantId, name: 'Buyer Co', email: buyerEmail } })
  const order = await orderDb.order.create({
    data: { tenantId, customerId: customer.id, channel: 'B2B_PORTAL', totalAmount: 100, paymentMethod: 'NET_TERMS', status: 'SHIPPED' },
  })
  orderId = order.id
  const invoice = await orderDb.invoice.create({
    data: { tenantId, orderId, invoiceNumber: `INV-${randomUUID().slice(0, 6)}`, customerId: customer.id, subtotal: 100, taxAmount: 0, totalAmount: 100 },
  })
  invoiceId = invoice.id
})

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await paymentDb.paymentIntent.deleteMany({ where: { tenantId } })
  await orderDb.invoice.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

function post(token: string, path: string, body: unknown) {
  return handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const amountPaid = async () => Number((await orderDb.order.findUniqueOrThrow({ where: { id: orderId } })).amountPaid)

test('a buyer cannot mark their own invoice or order paid with a manual payment', async () => {
  const buyer = await login('STAFF', buyerEmail)
  const viaInvoice = await post(buyer, `/invoices/${invoiceId}/payments`, { amount: 100, method: 'CASH' })
  assert.equal(viaInvoice.status, 403)
  assert.match(((await viaInvoice.json()) as { message: string }).message, /Pay by card/)
  assert.equal((await post(buyer, `/orders/${orderId}/payments`, { amount: 100, method: 'ACH' })).status, 403)
  assert.equal(await amountPaid(), 0)
})

test('staff without finance rights cannot record one either', async () => {
  const rep = await login('SALES_REP')
  assert.equal((await post(rep, `/invoices/${invoiceId}/payments`, { amount: 10, method: 'CHECK' })).status, 403)
  assert.equal(await amountPaid(), 0)
})

test('finance staff can still record money received outside the app', async () => {
  const accountant = await login('ACCOUNTANT')
  const res = await post(accountant, `/invoices/${invoiceId}/payments`, { amount: 40, method: 'CHECK', reference: 'chk-1001' })
  assert.equal(res.status, 200)
  assert.equal(await amountPaid(), 40)
})

test('a buyer cannot authorize a cash or check "payment" that would be captured at packing', async () => {
  const buyer = await login('STAFF', `cash-${buyerEmail}`)
  const customer = await crmDb.customer.create({ data: { tenantId, name: 'Cash Co', email: `cash-${buyerEmail}` } })
  const order = await orderDb.order.create({
    data: { tenantId, customerId: customer.id, channel: 'B2B_PORTAL', totalAmount: 50, paymentMethod: 'CASH' },
  })
  for (const method of ['CASH', 'CHECK']) {
    const res = await handleApiRequest(
      new Request('http://localhost/api/v1/payments/authorize', {
        method: 'POST',
        headers: { authorization: `Bearer ${buyer}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
        body: JSON.stringify({ orderId: order.id, customerId: customer.id, amount: 50, currency: 'usd', paymentMethod: method, correlationId: randomUUID() }),
      }),
    )
    assert.equal(res.status, 403, method)
  }
  assert.equal(await paymentDb.paymentIntent.count({ where: { tenantId, orderId: order.id } }), 0)
})
