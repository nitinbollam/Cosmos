import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { crmDb, inventoryDb, orderDb, tenantDb, wmsDb } from './db'
import { dispatchFulfillmentTask } from './order-orchestration'
import { ApiError } from './session'

const tenantId = `t-${randomUUID()}`
let customerId = ''
const PRICE = '5.00'

before(async () => {
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `disp-${tenantId.slice(-8)}`, displayName: 'Dispatch Co', settings: {}, metadata: {} },
  })
  customerId = (await crmDb.customer.create({ data: { tenantId, name: 'Buyer', email: 'b@buyer.test' } })).id
})

after(async () => {
  await orderDb.shipmentInvoice.deleteMany({ where: { tenantId } })
  await orderDb.backorderMove.deleteMany({ where: { tenantId } })
  await orderDb.postingJob.deleteMany({ where: { tenantId } })
  await orderDb.backorderLine.deleteMany({ where: { tenantId } })
  await orderDb.invoice.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await wmsDb.fulfillmentTask.deleteMany({ where: { tenantId } })
  await inventoryDb.shipmentCommit.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId } })
  await inventoryDb.stockReservation.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
})

/** Order of 10 with 6 picked: a short pick, so every step of dispatch has work to do. */
async function seed(ordered = 10, picked = 6) {
  const skuId = `sku-${randomUUID()}`
  const warehouseId = `wh-${randomUUID()}`
  await inventoryDb.sKU.create({
    data: { id: skuId, tenantId, code: skuId, name: 'Widget', category: 'GENERAL', cost: '2.00', price: PRICE, imageUrls: [], attributes: {} },
  })
  const order = await orderDb.order.create({
    data: {
      tenantId,
      customerId,
      channel: 'B2B_PORTAL',
      paymentMethod: 'NET_TERMS',
      status: 'PACKED',
      taxAmount: '0',
      totalAmount: (ordered * Number(PRICE)).toFixed(2),
      lineItems: { create: [{ skuId, warehouseId, quantity: ordered, quantityAllocated: ordered, unitPrice: PRICE }] },
    },
  })
  await inventoryDb.stockLevel.create({
    data: {
      tenantId,
      skuId,
      warehouseId,
      batchId: '',
      quantityOnHand: 20,
      quantityReserved: ordered,
      quantityAvailable: 20 - ordered,
    },
  })
  await inventoryDb.stockReservation.create({
    data: {
      id: randomUUID(),
      tenantId,
      orderId: order.id,
      skuId,
      warehouseId,
      batchId: '',
      quantity: ordered,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  })
  const task = await wmsDb.fulfillmentTask.create({
    data: {
      tenantId,
      orderId: order.id,
      status: 'PACKED',
      correlationId: randomUUID(),
      warehouseId,
      warehouseCode: 'W1',
      pickLines: { create: [{ skuId, warehouseId, quantity: ordered, pickedQty: picked, status: 'PICKED' as never }] },
    },
  })
  return { orderId: order.id, taskId: task.id, skuId, warehouseId }
}

async function snapshot(s: { orderId: string; taskId: string; skuId: string; warehouseId: string }) {
  const level = await inventoryDb.stockLevel.findFirstOrThrow({
    where: { tenantId, skuId: s.skuId, warehouseId: s.warehouseId },
  })
  const ledger = await inventoryDb.stockLedgerEntry.findMany({
    where: { tenantId, skuId: s.skuId, eventType: 'STOCK_SHIPPED' },
  })
  const res = await inventoryDb.stockReservation.findMany({ where: { tenantId, orderId: s.orderId } })
  const order = await orderDb.order.findFirstOrThrow({ where: { id: s.orderId }, include: { lineItems: true, invoice: true } })
  const jobs = await orderDb.postingJob.findMany({ where: { tenantId, sourceId: { in: [s.orderId, order.invoice?.id ?? 'none'] } } })
  const task = await wmsDb.fulfillmentTask.findFirstOrThrow({ where: { id: s.taskId } })
  const backorder = await orderDb.backorderLine.findFirst({ where: { orderId: s.orderId } })
  return {
    onHand: level.quantityOnHand,
    reserved: level.quantityReserved,
    available: level.quantityAvailable,
    shippedEntries: ledger.length,
    reservations: res.map((r) => r.status),
    orderStatus: order.status,
    invoiceSubtotal: order.invoice?.subtotal.toFixed(2) ?? null,
    quantityInvoiced: order.lineItems[0].quantityInvoiced,
    quantityBackordered: order.lineItems[0].quantityBackordered,
    backorderQty: backorder?.quantity ?? 0,
    invoiceJobs: jobs.filter((j) => j.kind === 'INVOICE_JOURNAL' || j.kind === 'INVOICE_EXTENSION_JOURNAL').length,
    cogsJobs: jobs.filter((j) => j.kind === 'COGS_JOURNAL').length,
    taskStatus: task.status,
    step: task.dispatchStep,
  }
}

/** Make one write throw once, the way a crash between two steps would. */
async function failOnce<T extends object, K extends keyof T>(
  target: T,
  key: K,
  when: (args: never) => boolean,
  run: () => Promise<unknown>,
) {
  const original = target[key] as unknown as (...a: never[]) => unknown
  let armed = true
  ;(target as Record<K, unknown>)[key] = (...args: never[]) => {
    if (armed && when(args[0] as never)) {
      armed = false
      throw new Error('injected fault')
    }
    return original.apply(target, args)
  }
  try {
    await run()
  } finally {
    ;(target as Record<K, unknown>)[key] = original
  }
}

test('a clean dispatch ships, backorders, invoices and queues COGS once', async () => {
  const s = await seed()
  const res = await dispatchFulfillmentTask(tenantId, s.taskId)
  assert.equal(res.status, 'DISPATCHED')
  const snap = await snapshot(s)
  assert.deepEqual(snap, {
    onHand: 14,
    reserved: 0,
    available: 14 + 0,
    shippedEntries: 1,
    reservations: ['FULFILLED'],
    orderStatus: 'SHIPPED',
    invoiceSubtotal: '30.00',
    quantityInvoiced: 6,
    quantityBackordered: 4,
    backorderQty: 4,
    invoiceJobs: 1,
    cogsJobs: 1,
    taskStatus: 'DISPATCHED',
    step: 'POSTED',
  })
})

test('calling dispatch again after it finished returns the same result and changes nothing', async () => {
  const s = await seed()
  const first = await dispatchFulfillmentTask(tenantId, s.taskId)
  const before = await snapshot(s)
  const second = await dispatchFulfillmentTask(tenantId, s.taskId)
  assert.deepEqual(second.shipped, first.shipped)
  assert.deepEqual(await snapshot(s), before)
})

const faults: Array<{ name: string; arm: (run: () => Promise<unknown>) => Promise<void> }> = [
  {
    name: 'after the stock commit',
    arm: (run) => failOnce(wmsDb.fulfillmentTask, 'update', (a: { data?: { dispatchStep?: string } }) => a?.data?.dispatchStep === 'COMMITTED', run),
  },
  {
    name: 'after the short-pick move',
    arm: (run) => failOnce(wmsDb.fulfillmentTask, 'update', (a: { data?: { dispatchStep?: string } }) => a?.data?.dispatchStep === 'BACKORDERED', run),
  },
  {
    name: 'after the task is marked DISPATCHED',
    arm: (run) => failOnce(wmsDb.fulfillmentTask, 'update', (a: { data?: { dispatchStep?: string } }) => a?.data?.dispatchStep === 'MARKED', run),
  },
  {
    name: 'inside invoicing',
    // The second order-database transaction in a dispatch is the invoice (the first is the backorder move).
    arm: (() => {
      let calls = 0
      return (run: () => Promise<unknown>) => failOnce(orderDb, '$transaction', () => ++calls === 2, run)
    })(),
  },
  {
    name: 'after invoicing',
    arm: (run) => failOnce(wmsDb.fulfillmentTask, 'update', (a: { data?: { dispatchStep?: string } }) => a?.data?.dispatchStep === 'POSTED', run),
  },
]

for (const f of faults) {
  test(`a retry ${f.name} ends in the same state as an uninterrupted dispatch`, async () => {
    const clean = await seed()
    await dispatchFulfillmentTask(tenantId, clean.taskId)
    const expected = await snapshot(clean)

    const s = await seed()
    await f.arm(async () => {
      await assert.rejects(() => dispatchFulfillmentTask(tenantId, s.taskId), /injected fault/)
    })
    await dispatchFulfillmentTask(tenantId, s.taskId)
    assert.deepEqual(await snapshot(s), expected)
  })
}

test('a failed attempt does not leave the task locked', async () => {
  const s = await seed()
  await faults[0].arm(async () => {
    await assert.rejects(() => dispatchFulfillmentTask(tenantId, s.taskId), /injected fault/)
  })
  const task = await wmsDb.fulfillmentTask.findFirstOrThrow({ where: { id: s.taskId } })
  assert.equal(task.dispatchClaimedAt, null)
})

test('a task being dispatched elsewhere is refused with 409', async () => {
  const s = await seed()
  await wmsDb.fulfillmentTask.update({ where: { id: s.taskId }, data: { dispatchClaimedAt: new Date() } })
  await assert.rejects(
    () => dispatchFulfillmentTask(tenantId, s.taskId),
    (err: unknown) => err instanceof ApiError && err.status === 409,
  )
  const snap = await snapshot(s)
  assert.equal(snap.onHand, 20)
  assert.equal(snap.shippedEntries, 0)
})

test('a lease from a crashed attempt expires and the task can be dispatched', async () => {
  const s = await seed()
  await wmsDb.fulfillmentTask.update({ where: { id: s.taskId }, data: { dispatchClaimedAt: new Date(Date.now() - 10 * 60_000) } })
  await dispatchFulfillmentTask(tenantId, s.taskId)
  assert.equal((await snapshot(s)).step, 'POSTED')
})

test('picked stock with nothing to commit raises instead of invoicing zero', async () => {
  const s = await seed()
  await inventoryDb.stockReservation.updateMany({ where: { tenantId, orderId: s.orderId }, data: { status: 'FULFILLED' } })
  await assert.rejects(() => dispatchFulfillmentTask(tenantId, s.taskId), /found no stock to commit/)
  const snap = await snapshot(s)
  assert.equal(snap.invoiceSubtotal, null)
  assert.equal(snap.step, null)
})

test('two simultaneous dispatches of one task decrement stock once', { skip: process.env.PLEROS_DB_PROVIDER !== 'postgres' }, async () => {
  const s = await seed()
  const results = await Promise.allSettled([dispatchFulfillmentTask(tenantId, s.taskId), dispatchFulfillmentTask(tenantId, s.taskId)])
  const ok = results.filter((r) => r.status === 'fulfilled')
  assert.ok(ok.length >= 1)
  for (const r of results) {
    if (r.status === 'rejected') assert.ok(r.reason instanceof ApiError && r.reason.status === 409)
  }
  const snap = await snapshot(s)
  assert.equal(snap.onHand, 14)
  assert.equal(snap.shippedEntries, 1)
  assert.equal(snap.invoiceJobs, 1)
  assert.equal(snap.cogsJobs, 1)
})

test('serial enforcement can be repeated after the units already shipped', async () => {
  const { enforceAndShipSerialsForOrder } = await import('./inventory-serials')
  const skuId = `sku-${randomUUID()}`
  const orderId = `ord-${randomUUID()}`
  await inventoryDb.sKU.create({
    data: { id: skuId, tenantId, code: skuId, name: 'Serial', category: 'GENERAL', cost: '1', price: '2', trackSerial: true, imageUrls: [], attributes: {} },
  })
  for (const n of ['A1', 'A2']) {
    await inventoryDb.serialUnit.create({
      data: { tenantId, skuId, warehouseId: 'wh', serialNumber: `${skuId}-${n}`, status: 'RESERVED', orderId },
    })
  }
  await enforceAndShipSerialsForOrder(tenantId, orderId, [{ skuId, quantity: 2 }])
  await enforceAndShipSerialsForOrder(tenantId, orderId, [{ skuId, quantity: 2 }])
  const units = await inventoryDb.serialUnit.findMany({ where: { tenantId, orderId } })
  assert.deepEqual(units.map((u) => u.status), ['SHIPPED', 'SHIPPED'])
  await assert.rejects(() => enforceAndShipSerialsForOrder(tenantId, orderId, [{ skuId, quantity: 3 }]), /assign 3 serial/)
  await inventoryDb.serialUnit.deleteMany({ where: { tenantId, skuId } })
})
