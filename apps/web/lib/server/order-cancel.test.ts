import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { crmDb, inventoryDb, orderDb, paymentDb, tenantDb, wmsDb } from './db'
import { applyCreditUsed } from './credit-limit'
import { cancelOrderWithCompensation, dispatchFulfillmentTask } from './order-orchestration'
import { releaseReservationsOfDeadOrders } from './reservation-safety-net'
import { ApiError } from './session'

const tenantId = `t-${randomUUID()}`
let customerId = ''

before(async () => {
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `cancel-${tenantId.slice(-8)}`, displayName: 'Cancel Co', settings: {}, metadata: {} },
  })
  customerId = (await crmDb.customer.create({ data: { tenantId, name: 'Buyer', email: 'b@buyer.test', creditLimit: 100000 } })).id
})

after(async () => {
  await orderDb.shipmentInvoice.deleteMany({ where: { tenantId } })
  await orderDb.backorderMove.deleteMany({ where: { tenantId } })
  await orderDb.postingJob.deleteMany({ where: { tenantId } })
  await orderDb.orderSaga.deleteMany({ where: { tenantId } })
  await orderDb.backorderLine.deleteMany({ where: { tenantId } })
  await orderDb.invoice.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await paymentDb.paymentIntent.deleteMany({ where: { tenantId } })
  await wmsDb.fulfillmentTask.deleteMany({ where: { tenantId } })
  await inventoryDb.shipmentCommit.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId } })
  await inventoryDb.stockReservation.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await crmDb.creditApplication.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
})

async function seed(opts: { net?: boolean; status?: string; taskStatus?: string; picked?: number } = {}) {
  const qty = 5
  const skuId = `sku-${randomUUID()}`
  const warehouseId = `wh-${randomUUID()}`
  await inventoryDb.sKU.create({
    data: { id: skuId, tenantId, code: skuId, name: 'Widget', category: 'GENERAL', cost: '2.00', price: '5.00', imageUrls: [], attributes: {} },
  })
  await inventoryDb.stockLevel.create({
    data: { tenantId, skuId, warehouseId, batchId: '', quantityOnHand: 20, quantityReserved: qty, quantityAvailable: 20 - qty },
  })
  const order = await orderDb.order.create({
    data: {
      tenantId,
      customerId,
      channel: 'B2B_PORTAL',
      paymentMethod: opts.net ? 'NET_TERMS' : 'CARD',
      status: (opts.status ?? 'PROCESSING') as never,
      taxAmount: '0',
      totalAmount: '25.00',
      lineItems: { create: [{ skuId, warehouseId, quantity: qty, quantityAllocated: qty, unitPrice: '5.00' }] },
    },
  })
  await inventoryDb.stockReservation.create({
    data: { id: randomUUID(), tenantId, orderId: order.id, skuId, warehouseId, batchId: '', quantity: qty, status: 'ACTIVE', expiresAt: new Date(Date.now() + 86_400_000) },
  })
  const task = await wmsDb.fulfillmentTask.create({
    data: {
      tenantId,
      orderId: order.id,
      status: (opts.taskStatus ?? 'PENDING') as never,
      correlationId: randomUUID(),
      warehouseId,
      warehouseCode: 'W1',
      pickLines: { create: [{ skuId, warehouseId, quantity: qty, pickedQty: opts.picked ?? 0, status: 'PENDING' }] },
    },
  })
  if (opts.net) await applyCreditUsed(tenantId, customerId, 25, order.id)
  return { orderId: order.id, taskId: task.id, skuId, warehouseId }
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

/** Make one call to `target[key]` throw (when `when` agrees), as a failing dependency would. */
function failOnce<T>(target: object, key: string, when: (args: never) => boolean, fn: () => Promise<T>) {
  const original = (target as Record<string, (...a: never[]) => unknown>)[key].bind(target)
  let armed = true
  return withPatched(
    target,
    key,
    (...args: never[]) => {
      if (armed && when(args[0] as never)) {
        armed = false
        throw new Error('injected fault')
      }
      return original(...args)
    },
    fn,
  )
}

async function state(s: { orderId: string; taskId: string; skuId: string; warehouseId: string }) {
  const order = await orderDb.order.findFirstOrThrow({ where: { id: s.orderId } })
  const res = await inventoryDb.stockReservation.findMany({ where: { tenantId, orderId: s.orderId } })
  const level = await inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId: s.skuId, warehouseId: s.warehouseId } })
  const task = await wmsDb.fulfillmentTask.findFirstOrThrow({ where: { id: s.taskId } })
  return {
    status: order.status,
    reservations: res.map((r) => r.status),
    reserved: level.quantityReserved,
    task: task.status,
  }
}

const faults: Array<{ step: string; run: <T>(fn: () => Promise<T>) => Promise<T> }> = [
  { step: 'fulfillment', run: (fn) => failOnce(wmsDb.fulfillmentTask, 'updateMany', (a: { data?: { status?: string } }) => a?.data?.status === 'CANCELLED', fn) },
  { step: 'reservations', run: (fn) => failOnce(inventoryDb.stockReservation, 'findMany', () => true, fn) },
  { step: 'backorders', run: (fn) => failOnce(orderDb.backorderLine, 'updateMany', () => true, fn) },
  { step: 'credit', run: (fn) => failOnce(crmDb, '$transaction', () => true, fn) },
]

for (const f of faults) {
  test(`a failure at "${f.step}" stops the cancel, names the step, and the next cancel completes it`, async () => {
    const s = await seed({ net: true })
    const creditBefore = await creditUsed()
    await f.run(async () => {
      await assert.rejects(
        () => cancelOrderWithCompensation(tenantId, s.orderId, 'customer request'),
        (err: unknown) => err instanceof ApiError && err.status === 502 && err.message.includes(`"${f.step}"`),
      )
    })
    assert.notEqual((await state(s)).status, 'CANCELLED', 'not cancelled while a step is outstanding')

    await cancelOrderWithCompensation(tenantId, s.orderId, 'customer request')
    assert.deepEqual(await state(s), { status: 'CANCELLED', reservations: ['RELEASED'], reserved: 0, task: 'CANCELLED' })
    assert.equal(await creditUsed(), creditBefore - 25, 'credit released exactly once')

    const saga = await orderDb.orderSaga.findFirstOrThrow({ where: { orderId: s.orderId } })
    const cancel = (saga.compensations as { cancel: { complete: boolean; steps: Record<string, string> } }).cancel
    assert.equal(cancel.complete, true)
    assert.equal(cancel.steps[f.step], 'done')
  })
}

test('cancelling again after it finished changes nothing', async () => {
  const s = await seed({ net: true })
  await cancelOrderWithCompensation(tenantId, s.orderId, 'x')
  const credit = await creditUsed()
  await cancelOrderWithCompensation(tenantId, s.orderId, 'x')
  assert.equal(await creditUsed(), credit)
})

async function seedPaid(captured: string, refunded: string, amountPaid: string) {
  const s = await seed()
  await orderDb.order.update({ where: { id: s.orderId }, data: { amountPaid } })
  const intent = await paymentDb.paymentIntent.create({
    data: {
      tenantId,
      orderId: s.orderId,
      amount: captured,
      capturedAmount: captured,
      refundedAmount: refunded,
      paymentMethod: 'CARD',
      status: 'CAPTURED',
      customerId,
      correlationId: randomUUID(),
      metadata: {},
    },
  })
  return { ...s, intentId: intent.id }
}

test('capture $100, refund $30, cancel: refunds $70 and amountPaid ends at 0', async () => {
  const s = await seedPaid('100.00', '30.00', '70.00')
  await cancelOrderWithCompensation(tenantId, s.orderId, 'x')
  const intent = await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: s.intentId } })
  assert.equal(intent.status, 'REFUNDED')
  assert.equal(Number(intent.refundedAmount), 100)
  assert.equal(Number((await orderDb.order.findFirstOrThrow({ where: { id: s.orderId } })).amountPaid), 0)
})

test('a refund that fails puts amountPaid back, and the retry refunds once', async () => {
  const s = await seedPaid('100.00', '0', '100.00')
  await failOnce(paymentDb.paymentIntent, 'updateMany', () => true, async () => {
    await assert.rejects(() => cancelOrderWithCompensation(tenantId, s.orderId, 'x'), /"payments"/)
  })
  assert.equal(Number((await orderDb.order.findFirstOrThrow({ where: { id: s.orderId } })).amountPaid), 100)
  await cancelOrderWithCompensation(tenantId, s.orderId, 'x')
  assert.equal(Number((await orderDb.order.findFirstOrThrow({ where: { id: s.orderId } })).amountPaid), 0)
  assert.equal(Number((await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: s.intentId } })).refundedAmount), 100)
})

test('a crash after the refund but before it was recorded is not taken off amountPaid twice', async () => {
  const s = await seedPaid('100.00', '0', '100.00')
  await failOnce(
    orderDb.orderSaga,
    'update',
    (a: { data?: { compensations?: { cancel?: { steps?: Record<string, string> } } } }) => a?.data?.compensations?.cancel?.steps?.payments === 'done',
    async () => {
      await assert.rejects(() => cancelOrderWithCompensation(tenantId, s.orderId, 'x'), /"payments"/)
    },
  )
  assert.equal(Number((await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: s.intentId } })).refundedAmount), 100)
  await cancelOrderWithCompensation(tenantId, s.orderId, 'x')
  assert.equal(Number((await orderDb.order.findFirstOrThrow({ where: { id: s.orderId } })).amountPaid), 0)
})

test('an authorized hold is voided on cancel', async () => {
  const s = await seed()
  const intent = await paymentDb.paymentIntent.create({
    data: { tenantId, orderId: s.orderId, amount: '25.00', paymentMethod: 'CARD', status: 'AUTHORIZED', customerId, correlationId: randomUUID(), metadata: {} },
  })
  await cancelOrderWithCompensation(tenantId, s.orderId, 'x')
  assert.equal((await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: intent.id } })).status, 'VOIDED')
})

test('an order that has shipped cannot be cancelled, and nothing is undone', async () => {
  const s = await seed({ status: 'SHIPPED' })
  await assert.rejects(
    () => cancelOrderWithCompensation(tenantId, s.orderId, 'x'),
    (err: unknown) => err instanceof ApiError && err.status === 400,
  )
  assert.deepEqual((await state(s)).reservations, ['ACTIVE'])
})

test('a cancel is refused with 409 while a dispatch holds the task', async () => {
  const s = await seed({ status: 'PACKED', taskStatus: 'PACKED', picked: 5 })
  await wmsDb.fulfillmentTask.update({ where: { id: s.taskId }, data: { dispatchClaimedAt: new Date() } })
  await assert.rejects(
    () => cancelOrderWithCompensation(tenantId, s.orderId, 'x'),
    (err: unknown) => err instanceof ApiError && err.status === 409,
  )
  assert.equal((await state(s)).status, 'PACKED')
})

test('safety net releases reservations held by cancelled or failed orders and leaves live ones', async () => {
  const dead = await seed({ status: 'CANCELLED' })
  const failed = await seed({ status: 'FAILED' })
  const live = await seed({ status: 'PROCESSING' })
  const r = await releaseReservationsOfDeadOrders({ tenantId })
  assert.equal(r.released, 2)
  assert.deepEqual((await state(dead)).reservations, ['RELEASED'])
  assert.deepEqual((await state(failed)).reservations, ['RELEASED'])
  assert.deepEqual((await state(live)).reservations, ['ACTIVE'])
  assert.equal((await releaseReservationsOfDeadOrders({ tenantId })).released, 0)
})

test('cancel and dispatch together end in one consistent state', { skip: process.env.PLEROS_DB_PROVIDER !== 'postgres' }, async () => {
  let shipped = 0
  let cancelled = 0
  for (let i = 0; i < 15; i++) {
    const s = await seed({ status: 'PACKED', taskStatus: 'PACKED', picked: 5 })
    await Promise.allSettled([
      (async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 15))
        return dispatchFulfillmentTask(tenantId, s.taskId)
      })(),
      (async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 15))
        return cancelOrderWithCompensation(tenantId, s.orderId, 'race')
      })(),
    ])
    const st = await state(s)
    if (st.status === 'SHIPPED') {
      shipped++
      assert.deepEqual(st.reservations, ['FULFILLED'])
      assert.equal((await orderDb.invoice.count({ where: { orderId: s.orderId } })), 1, 'shipped orders are invoiced')
    } else {
      cancelled++
      assert.equal(st.status, 'CANCELLED')
      assert.deepEqual(st.reservations, ['RELEASED'])
      assert.equal(st.reserved, 0)
    }
  }
  assert.equal(shipped + cancelled, 15)
})
