import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { crmDb, inventoryDb, orderDb, tenantDb, wmsDb } from './db'
import { applyCreditUsed, releaseOrderCredit } from './credit-limit'
import { runOrderFulfillmentPipeline, transitionOrderStatus } from './order-orchestration'
import { runOrderSaga } from './order-saga'
import { ApiError } from './session'

const tenantId = `t-${randomUUID()}`
let customerId = ''

before(async () => {
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `saga-${tenantId.slice(-8)}`, displayName: 'Saga Co', settings: {}, metadata: {} },
  })
  customerId = (await crmDb.customer.create({ data: { tenantId, name: 'Buyer', email: 'b@buyer.test', creditLimit: 100000 } })).id
})

after(async () => {
  await orderDb.orderSaga.deleteMany({ where: { tenantId } })
  await orderDb.backorderLine.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await wmsDb.fulfillmentTask.deleteMany({ where: { tenantId } })
  await inventoryDb.stockReservation.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await crmDb.creditApplication.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
})

async function seed(opts: { qty?: number; onHand?: number; net?: boolean; total?: string; status?: string } = {}) {
  const qty = opts.qty ?? 5
  const skuId = `sku-${randomUUID()}`
  const warehouseId = `wh-${randomUUID()}`
  await inventoryDb.sKU.create({
    data: { id: skuId, tenantId, code: skuId, name: 'Widget', category: 'GENERAL', cost: '2.00', price: '5.00', imageUrls: [], attributes: {} },
  })
  await inventoryDb.stockLevel.create({
    data: {
      tenantId,
      skuId,
      warehouseId,
      batchId: '',
      quantityOnHand: opts.onHand ?? 50,
      quantityReserved: 0,
      quantityAvailable: opts.onHand ?? 50,
    },
  })
  const order = await orderDb.order.create({
    data: {
      tenantId,
      customerId,
      channel: 'B2B_PORTAL',
      paymentMethod: opts.net ? 'NET_TERMS' : 'CARD',
      status: (opts.status ?? 'PENDING') as never,
      taxAmount: '0',
      totalAmount: opts.total ?? (qty * 5).toFixed(2),
      lineItems: { create: [{ skuId, warehouseId, quantity: qty, unitPrice: '5.00' }] },
    },
  })
  return { orderId: order.id, skuId, warehouseId, qty }
}

const creditUsed = async () => Number((await crmDb.customer.findFirstOrThrow({ where: { id: customerId } })).creditUsed)

async function withPatched<T>(obj: object, key: string, replacement: unknown, fn: () => Promise<T>): Promise<T> {
  const o = obj as Record<string, unknown>
  const original = o[key]
  o[key] = replacement
  try {
    return await fn()
  } finally {
    o[key] = original
  }
}

/** Make the saga write that records `step` throw once, as a crash right after the step's effect would. */
async function crashAfterStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const original = orderDb.orderSaga.update.bind(orderDb.orderSaga)
  let armed = true
  return withPatched(orderDb.orderSaga, 'update', (args: { data?: { completedSteps?: string[] } }) => {
    if (armed && Array.isArray(args?.data?.completedSteps) && args.data.completedSteps.includes(step)) {
      armed = false
      throw new Error('injected crash')
    }
    return original(args as never)
  }, fn)
}

test('credit is applied once per order however often the step repeats', async () => {
  const { orderId } = await seed({ net: true })
  const before = await creditUsed()
  await applyCreditUsed(tenantId, customerId, 25, orderId)
  await applyCreditUsed(tenantId, customerId, 25, orderId)
  assert.equal(await creditUsed(), before + 25)
})

test('rerunning the pipeline after the saga record was lost does not consume credit twice', async () => {
  const { orderId } = await seed({ net: true })
  const before = await creditUsed()
  await runOrderFulfillmentPipeline(orderId, tenantId, randomUUID())
  assert.equal(await creditUsed(), before + 25)

  // The state a crash between the credit write and the saga write leaves behind.
  await orderDb.orderSaga.update({ where: { orderId }, data: { status: 'PENDING', completedSteps: [] } })
  await orderDb.order.update({ where: { id: orderId }, data: { status: 'PENDING' } })
  await runOrderFulfillmentPipeline(orderId, tenantId, randomUUID())
  assert.equal(await creditUsed(), before + 25)
})

test('a failure after the credit step releases the credit, the stock and fails the order, and records each undo', async () => {
  const { orderId, skuId, warehouseId } = await seed({ net: true })
  const before = await creditUsed()
  await crashAfterStep('CONFIRM_ORDER', async () => {
    await assert.rejects(() => runOrderSaga(orderId, tenantId, randomUUID()), /injected crash/)
  })
  assert.equal(await creditUsed(), before, 'credit released')
  const order = await orderDb.order.findFirstOrThrow({ where: { id: orderId } })
  assert.equal(order.status, 'FAILED')
  const active = await inventoryDb.stockReservation.count({ where: { tenantId, orderId, status: 'ACTIVE' } })
  assert.equal(active, 0)
  const level = await inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId, warehouseId } })
  assert.equal(level.quantityReserved, 0)
  const saga = await orderDb.orderSaga.findFirstOrThrow({ where: { orderId } })
  assert.equal(saga.status, 'FAILED')
  assert.deepEqual(saga.compensations, { reservations: 'done', fulfillment: 'done', credit: 'done', status: 'done' })
})

test('a failed pipeline is visible to the caller of runOrderSaga', async () => {
  const { orderId } = await seed()
  await crashAfterStep('RESERVE_INVENTORY', async () => {
    await assert.rejects(() => runOrderSaga(orderId, tenantId, randomUUID()))
  })
})

test('a backordered order whose pipeline fails ends FAILED with nothing left reserved', async () => {
  const { orderId } = await seed({ qty: 10, onHand: 4 })
  await crashAfterStep('CREATE_DROP_SHIP', async () => {
    await assert.rejects(() => runOrderSaga(orderId, tenantId, randomUUID()), /injected crash/)
  })
  const order = await orderDb.order.findFirstOrThrow({ where: { id: orderId } })
  assert.equal(order.status, 'FAILED')
  assert.equal(await inventoryDb.stockReservation.count({ where: { tenantId, orderId, status: 'ACTIVE' } }), 0)
})

test('completed steps are saved as each step finishes', async () => {
  const { orderId } = await seed()
  await crashAfterStep('CONFIRM_ORDER', async () => {
    await assert.rejects(() => runOrderSaga(orderId, tenantId, randomUUID()))
  })
  const saga = await orderDb.orderSaga.findFirstOrThrow({ where: { orderId } })
  for (const step of ['RESERVE_INVENTORY', 'CREATE_DROP_SHIP', 'CREATE_FULFILLMENT']) {
    assert.ok((saga.completedSteps as string[]).includes(step), `${step} recorded`)
  }
})

test('two simultaneous transitions never leave the order in a status that contradicts a success', async () => {
  for (let i = 0; i < 30; i++) {
    const { orderId } = await seed({ status: 'PROCESSING' })
    const [pack, cancel] = await Promise.allSettled([
      transitionOrderStatus(tenantId, orderId, 'PACKED'),
      transitionOrderStatus(tenantId, orderId, 'CANCELLED'),
    ])
    const final = (await orderDb.order.findFirstOrThrow({ where: { id: orderId } })).status
    // Pack then cancel in sequence is legal (PACKED -> CANCELLED). What must never happen is both
    // reading PROCESSING and both writing: a loser is told 409 and its change does not apply.
    if (cancel.status === 'fulfilled') assert.equal(final, 'CANCELLED')
    else assert.equal(final, 'PACKED')
    // A loser is refused one of two ways, depending on timing: 409 when both read PROCESSING and
    // the other write landed first, or 400 "cannot transition" when it read after the winner had
    // already committed (a cancelled order cannot be packed). Both leave the winner's status alone.
    if (pack.status === 'rejected') {
      assert.ok(pack.reason instanceof ApiError && [409, 400].includes(pack.reason.status), 'pack loser is refused')
      assert.equal(final, 'CANCELLED')
    }
    if (cancel.status === 'rejected') {
      assert.ok(cancel.reason instanceof ApiError && [409, 400].includes(cancel.reason.status), 'cancel loser is refused')
      assert.equal(final, 'PACKED')
    }
    assert.ok(pack.status === 'fulfilled' || cancel.status === 'fulfilled', 'at least one wins')
  }
})

test('a stale-status write is refused with 409 and applies nothing', async () => {
  const { orderId } = await seed({ status: 'PROCESSING' })
  // Another caller moves the order between our read and our write.
  const original = orderDb.order.findFirst.bind(orderDb.order)
  let first = true
  await withPatched(orderDb.order, 'findFirst', async (args: never) => {
    const row = await original(args)
    if (first && row) {
      first = false
      await orderDb.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } })
    }
    return row
  }, async () => {
    await assert.rejects(
      () => transitionOrderStatus(tenantId, orderId, 'PACKED'),
      (err: unknown) => err instanceof ApiError && err.status === 409 && /CANCELLED/.test(err.message),
    )
  })
  assert.equal((await orderDb.order.findFirstOrThrow({ where: { id: orderId } })).status, 'CANCELLED')
})

test('repeating the transition that already happened is a no-op, not an error', async () => {
  const { orderId } = await seed({ status: 'PROCESSING' })
  await transitionOrderStatus(tenantId, orderId, 'PACKED')
  const again = await transitionOrderStatus(tenantId, orderId, 'PACKED')
  assert.equal(again.status, 'PACKED')
})

test('two pipeline starts for one order allocate each line once', async () => {
  for (let i = 0; i < 10; i++) {
    const { orderId, skuId, warehouseId, qty } = await seed({ net: true })
    const before = await creditUsed()
    const [a, b] = await Promise.all([
      runOrderFulfillmentPipeline(orderId, tenantId, randomUUID()),
      runOrderFulfillmentPipeline(orderId, tenantId, randomUUID()),
    ])
    assert.ok([a, b].includes('COMPLETED'))
    const line = await orderDb.orderLineItem.findFirstOrThrow({ where: { orderId } })
    assert.equal(line.quantityAllocated, qty)
    const level = await inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId, warehouseId } })
    assert.equal(level.quantityReserved, qty)
    assert.equal(await creditUsed(), before + qty * 5)
  }
})

test('a cancel-time credit release happens once', async () => {
  const { orderId } = await seed({ net: true })
  await applyCreditUsed(tenantId, customerId, 25, orderId)
  const before = await creditUsed()
  await releaseOrderCredit(tenantId, customerId, orderId, 25)
  await releaseOrderCredit(tenantId, customerId, orderId, 25)
  assert.equal(await creditUsed(), before - 25)
})
