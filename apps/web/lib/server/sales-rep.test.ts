import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, inventoryDb, orderDb, storefrontDb, tenantDb } from './db'
import { updateTenantSalesTaxRate } from './tenant-tax'

const PASSWORD = 'sales-rep-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const uid: Record<string, string> = {}
let sku = ''
let mine = ''
let theirs = ''
let limited = ''

async function makeUser(key: string, role: 'SALES_REP' | 'MANAGER') {
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

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'R', slug: `r-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `r-${tenantId.slice(-8)}`, displayName: 'R', settings: {}, metadata: {} },
  })
  await updateTenantSalesTaxRate(tenantId, 0.1)
  await makeUser('a', 'SALES_REP')
  await makeUser('b', 'SALES_REP')
  await makeUser('m', 'MANAGER')
  const wh = await inventoryDb.warehouse.create({
    data: { tenantId, name: 'Main', code: `M-${randomUUID().slice(0, 4)}`, address: {}, isDefault: true },
  })
  sku = (await inventoryDb.sKU.create({
    data: { tenantId, code: `SK-${randomUUID().slice(0, 5)}`, name: 'Cases', price: 20, cost: 10, category: 'x', imageUrls: [], attributes: {} },
  })).id
  await inventoryDb.stockLevel.create({
    data: { tenantId, skuId: sku, warehouseId: wh.id, batchId: '', quantityOnHand: 500, quantityReserved: 0, quantityAvailable: 500 },
  })
  mine = (await crmDb.customer.create({ data: { tenantId, name: 'Mine Mart', salesRepUserId: uid.a, creditLimit: 1000 } })).id
  theirs = (await crmDb.customer.create({ data: { tenantId, name: 'Theirs Mart', salesRepUserId: uid.b } })).id
  limited = (await crmDb.customer.create({ data: { tenantId, name: 'Tight Credit', salesRepUserId: uid.a, creditLimit: 50 } })).id
  await crmDb.customerPrice.create({ data: { tenantId, customerId: mine, skuId: sku, unitPrice: 15 } })
})

after(async () => {
  await tenantDb.approvalRequest.deleteMany({ where: { tenantId } })
  await storefrontDb.b2BQuote.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await inventoryDb.stockReservation.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId } })
  await crmDb.lead.deleteMany({ where: { tenantId } })
  await crmDb.customerPrice.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

test('a rep sees their own accounts, a manager sees all, and another rep\'s account is a 404', async () => {
  const names = async (key: string, q = '') =>
    ((await (await call(key, 'GET', `/rep/accounts${q}`)).json()) as Array<{ name: string }>).map((c) => c.name).sort()
  assert.deepEqual(await names('a'), ['Mine Mart', 'Tight Credit'])
  assert.deepEqual(await names('a', '?scope=all'), ['Mine Mart', 'Tight Credit'])
  assert.deepEqual(await names('m'), ['Mine Mart', 'Theirs Mart', 'Tight Credit'])
  assert.equal((await call('a', 'GET', `/rep/accounts/${theirs}`)).status, 404)
  assert.equal((await call('m', 'GET', `/rep/accounts/${theirs}`)).status, 200)
  const detail = (await (await call('a', 'GET', `/rep/accounts/${mine}`)).json()) as { credit: { creditLimit: number; availableCredit: number } }
  assert.equal(detail.credit.creditLimit, 1000)
  assert.equal(detail.credit.availableCredit, 1000)
})

test('the catalog and the order use the customer\'s own price, whatever the client sends', async () => {
  const cat = (await (await call('a', 'GET', `/rep/accounts/${mine}/catalog`)).json()) as Array<{ id: string; unitPrice: number; listPrice: number }>
  const row = cat.find((c) => c.id === sku)!
  assert.equal(row.unitPrice, 15)
  assert.equal(row.listPrice, 20)

  const res = await call('a', 'POST', `/rep/accounts/${mine}/orders`, { lines: [{ skuId: sku, quantity: 4, unitPrice: 1 }], paymentMethod: 'CASH' })
  assert.equal(res.status, 201)
  const { order } = (await res.json()) as { order: { id: string } }
  const row2 = await orderDb.order.findUniqueOrThrow({ where: { id: order.id }, include: { lineItems: true } })
  assert.equal(row2.salesRepId, uid.a)
  assert.equal(row2.channel, 'SALES_REP')
  assert.equal(Number(row2.lineItems[0].unitPrice), 15)
  assert.equal(row2.lineItems[0].quantity, 4)

  assert.equal((await call('a', 'POST', `/rep/accounts/${theirs}/orders`, { lines: [{ skuId: sku, quantity: 1 }] })).status, 404)
  assert.equal((await call('a', 'POST', `/rep/accounts/${mine}/orders`, { lines: [] })).status, 400)
  assert.equal((await call('a', 'POST', `/rep/accounts/${mine}/orders`, { lines: [{ skuId: sku, quantity: 1 }], paymentMethod: 'CARD' })).status, 400)
})

test('an order on terms past the credit limit waits for approval and says so', async () => {
  const res = await call('a', 'POST', `/rep/accounts/${limited}/orders`, { lines: [{ skuId: sku, quantity: 10 }], paymentMethod: 'NET_TERMS' })
  assert.equal(res.status, 201)
  const body = (await res.json()) as { awaitingApproval: boolean; order: { status: string } }
  assert.equal(body.awaitingApproval, true)
  assert.equal(body.order.status, 'AWAITING_APPROVAL')
})

test('a quote is priced by the server for the customer', async () => {
  const res = await call('a', 'POST', `/rep/accounts/${mine}/quote`, { lines: [{ skuId: sku, quantity: 6, unitPrice: 1 }], notes: 'Spring deal' })
  assert.equal(res.status, 201)
  const quote = (await res.json()) as { lines: Array<{ qty: number; unitPrice: string | number }>; customerRef: string }
  assert.equal(quote.customerRef, mine)
  assert.equal(Number(quote.lines[0].unitPrice), 15)
  assert.equal(quote.lines[0].qty, 6)
  assert.equal((await call('a', 'POST', `/rep/accounts/${theirs}/quote`, { lines: [{ skuId: sku, quantity: 1 }] })).status, 404)
})

test('a credit increase is requested by the rep and applied only when a manager approves', async () => {
  const path = `/rep/accounts/${mine}/credit-request`
  assert.equal((await call('a', 'POST', path, { requestedLimit: 800, reason: 'Opening a second store' })).status, 400)
  assert.equal((await call('a', 'POST', path, { requestedLimit: 5000, reason: 'no' })).status, 400)
  assert.equal((await call('a', 'POST', `/rep/accounts/${theirs}/credit-request`, { requestedLimit: 5000, reason: 'Opening a second store' })).status, 404)

  const made = await call('a', 'POST', path, { requestedLimit: 5000, reason: 'Opening a second store' })
  assert.equal(made.status, 201)
  const request = (await made.json()) as { id: string; status: string }
  assert.equal(request.status, 'PENDING')
  assert.equal((await call('a', 'POST', path, { requestedLimit: 6000, reason: 'Opening a second store' })).status, 409)

  // Nothing changes yet, and a rep cannot approve their own request.
  assert.equal(Number((await crmDb.customer.findUniqueOrThrow({ where: { id: mine } })).creditLimit), 1000)
  assert.equal((await call('a', 'POST', `/approvals/${request.id}/decide`, { approve: true })).status, 403)
  const detail = (await (await call('a', 'GET', `/rep/accounts/${mine}`)).json()) as { pendingCreditRequest: { id: string } | null }
  assert.equal(detail.pendingCreditRequest?.id, request.id)
  assert.equal(((await (await call('b', 'GET', '/rep/credit-requests')).json()) as unknown[]).length, 0)

  assert.equal((await call('m', 'POST', `/approvals/${request.id}/decide`, { approve: true })).status, 200)
  assert.equal(Number((await crmDb.customer.findUniqueOrThrow({ where: { id: mine } })).creditLimit), 5000)
  const after = (await (await call('a', 'GET', `/rep/accounts/${mine}`)).json()) as { pendingCreditRequest: unknown; credit: { creditLimit: number } }
  assert.equal(after.pendingCreditRequest, null)
  assert.equal(after.credit.creditLimit, 5000)
})

test('a rejected credit request leaves the limit alone and the rep can ask again', async () => {
  const path = `/rep/accounts/${limited}/credit-request`
  const request = (await (await call('a', 'POST', path, { requestedLimit: 400, reason: 'Pays on time for a year' })).json()) as { id: string }
  assert.equal((await call('m', 'POST', `/approvals/${request.id}/decide`, { approve: false })).status, 400)
  assert.equal((await call('m', 'POST', `/approvals/${request.id}/decide`, { approve: false, rejectReason: 'Two late invoices' })).status, 200)
  assert.equal(Number((await crmDb.customer.findUniqueOrThrow({ where: { id: limited } })).creditLimit), 50)
  assert.equal((await call('a', 'POST', path, { requestedLimit: 200, reason: 'Pays on time for a year' })).status, 201)
})

test('leads: a rep sees theirs and unowned ones, claiming is one winner, converting makes them the account owner', async () => {
  const mk = async (companyName: string, assignedToUserId: string | null) =>
    (await crmDb.lead.create({ data: { tenantId, companyName, assignedToUserId, email: `${randomUUID().slice(0, 5)}@x.test` } })).id
  const free = await mk('Free Lead', null)
  const bs = await mk('B Lead', uid.b)
  const list = async (key: string) =>
    ((await (await call(key, 'GET', '/rep/leads')).json()) as Array<{ id: string }>).map((l) => l.id)
  const seenByA = await list('a')
  assert.ok(seenByA.includes(free))
  assert.ok(!seenByA.includes(bs))
  assert.ok((await list('m')).includes(bs))

  const [x, y] = await Promise.all([call('a', 'POST', `/rep/leads/${free}/claim`), call('b', 'POST', `/rep/leads/${free}/claim`)])
  const codes = [x.status, y.status].sort()
  assert.equal(codes[0], 200)
  assert.ok(codes[1] === 409 || codes[1] === 404, `loser got ${codes[1]}`)
  const owner = (await crmDb.lead.findUniqueOrThrow({ where: { id: free } })).assignedToUserId!
  const ownerKey = owner === uid.a ? 'a' : 'b'

  const other = ownerKey === 'a' ? 'b' : 'a'
  assert.equal((await call(other, 'POST', `/rep/leads/${free}/convert`, {})).status, 404)
  const conv = await call(ownerKey, 'POST', `/rep/leads/${free}/convert`, { name: 'Free Lead LLC' })
  assert.equal(conv.status, 200)
  const converted = (await conv.json()) as { customerId: string; status: string }
  assert.equal(converted.status, 'WON')
  assert.equal((await crmDb.customer.findUniqueOrThrow({ where: { id: converted.customerId } })).salesRepUserId, owner)

  const created = await call('a', 'POST', '/rep/leads', { companyName: ' New Co ' })
  assert.equal(created.status, 201)
  assert.equal(((await created.json()) as { assignedToUserId: string }).assignedToUserId, uid.a)
  assert.equal((await call('a', 'POST', '/rep/leads', { companyName: ' ' })).status, 400)
})
