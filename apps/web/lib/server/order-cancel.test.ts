import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { crmDb, inventoryDb, ledgerDb, orderDb, paymentDb, tenantDb, wmsDb } from './db'
import { applyCreditUsed } from './credit-limit'
import {
  cancelOrderWithCompensation,
  dispatchFulfillmentTask,
  transitionOrderStatus,
  withOrderFulfillmentLock,
} from './order-orchestration'
import { listInvoices, reconcileCancelledOrderInvoice } from './invoices'
import { enqueuePostingJob, postJob } from './posting-outbox'
import { ensurePostingAccounts } from './ledger-posting'
import { releaseReservationsOfDeadOrders } from './reservation-safety-net'
import { ApiError } from './session'
import * as wmsFulfillment from './wms-fulfillment'

const tenantId = `t-${randomUUID()}`
let customerId = ''

before(async () => {
  await tenantDb.tenantOrganization.create({
    data: {
      id: tenantId,
      slug: `cancel-${tenantId.slice(-8)}`,
      displayName: 'Cancel Co',
      settings: {},
      metadata: {},
    },
  })
  customerId = (
    await crmDb.customer.create({
      data: { tenantId, name: 'Buyer', email: 'b@buyer.test', creditLimit: 100000 },
    })
  ).id
})

after(async () => {
  await ledgerDb.journalLine.deleteMany({ where: { entry: { tenantId } } })
  await ledgerDb.journalEntry.deleteMany({ where: { tenantId } })
  await ledgerDb.chartAccount.deleteMany({ where: { tenantId } })
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

async function seed(
  opts: { net?: boolean; status?: string; taskStatus?: string; picked?: number } = {},
) {
  const qty = 5
  const skuId = `sku-${randomUUID()}`
  const warehouseId = `wh-${randomUUID()}`
  await inventoryDb.sKU.create({
    data: {
      id: skuId,
      tenantId,
      code: skuId,
      name: 'Widget',
      category: 'GENERAL',
      cost: '2.00',
      price: '5.00',
      imageUrls: [],
      attributes: {},
    },
  })
  await inventoryDb.stockLevel.create({
    data: {
      tenantId,
      skuId,
      warehouseId,
      batchId: '',
      quantityOnHand: 20,
      quantityReserved: qty,
      quantityAvailable: 20 - qty,
    },
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
      lineItems: {
        create: [{ skuId, warehouseId, quantity: qty, quantityAllocated: qty, unitPrice: '5.00' }],
      },
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
      quantity: qty,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  })
  const task = await wmsDb.fulfillmentTask.create({
    data: {
      tenantId,
      orderId: order.id,
      status: (opts.taskStatus ?? 'PENDING') as never,
      correlationId: randomUUID(),
      warehouseId,
      warehouseCode: 'W1',
      pickLines: {
        create: [
          { skuId, warehouseId, quantity: qty, pickedQty: opts.picked ?? 0, status: 'PENDING' },
        ],
      },
    },
  })
  if (opts.net) await applyCreditUsed(tenantId, customerId, 25, order.id)
  return { orderId: order.id, taskId: task.id, skuId, warehouseId }
}

const creditUsed = async () =>
  Number((await crmDb.customer.findFirstOrThrow({ where: { id: customerId } })).creditUsed)

async function withPatched<T>(
  obj: object,
  key: string,
  replacement: unknown,
  fn: () => Promise<T>,
): Promise<T> {
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
function failOnce<T>(
  target: object,
  key: string,
  when: (args: never) => boolean,
  fn: () => Promise<T>,
) {
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
  const res = await inventoryDb.stockReservation.findMany({
    where: { tenantId, orderId: s.orderId },
  })
  const level = await inventoryDb.stockLevel.findFirstOrThrow({
    where: { tenantId, skuId: s.skuId, warehouseId: s.warehouseId },
  })
  const task = await wmsDb.fulfillmentTask.findFirstOrThrow({ where: { id: s.taskId } })
  return {
    status: order.status,
    reservations: res.map((r) => r.status),
    reserved: level.quantityReserved,
    task: task.status,
  }
}

const faults: Array<{ step: string; run: <T>(fn: () => Promise<T>) => Promise<T> }> = [
  {
    step: 'fulfillment',
    run: (fn) =>
      failOnce(
        wmsDb.fulfillmentTask,
        'updateMany',
        (a: { data?: { status?: string } }) => a?.data?.status === 'CANCELLED',
        fn,
      ),
  },
  {
    step: 'reservations',
    run: (fn) => failOnce(inventoryDb.stockReservation, 'findMany', () => true, fn),
  },
  {
    step: 'backorders',
    run: (fn) => failOnce(orderDb.backorderLine, 'updateMany', () => true, fn),
  },
  { step: 'credit', run: (fn) => failOnce(crmDb, '$transaction', () => true, fn) },
]

for (const f of faults) {
  test(`a failure at "${f.step}" stops the cancel, names the step, and the next cancel completes it`, async () => {
    const s = await seed({ net: true })
    const creditBefore = await creditUsed()
    await f.run(async () => {
      await assert.rejects(
        () => cancelOrderWithCompensation(tenantId, s.orderId, 'customer request'),
        (err: unknown) =>
          err instanceof ApiError && err.status === 502 && err.message.includes(`"${f.step}"`),
      )
    })
    assert.notEqual(
      (await state(s)).status,
      'CANCELLED',
      'not cancelled while a step is outstanding',
    )

    await cancelOrderWithCompensation(tenantId, s.orderId, 'customer request')
    assert.deepEqual(await state(s), {
      status: 'CANCELLED',
      reservations: ['RELEASED'],
      reserved: 0,
      task: 'CANCELLED',
    })
    assert.equal(await creditUsed(), creditBefore - 25, 'credit released exactly once')

    const saga = await orderDb.orderSaga.findFirstOrThrow({ where: { orderId: s.orderId } })
    const cancel = (
      saga.compensations as { cancel: { complete: boolean; steps: Record<string, string> } }
    ).cancel
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
  assert.equal(
    Number((await orderDb.order.findFirstOrThrow({ where: { id: s.orderId } })).amountPaid),
    0,
  )
})

test('a refund that fails puts amountPaid back, and the retry refunds once', async () => {
  const s = await seedPaid('100.00', '0', '100.00')
  await failOnce(
    paymentDb.paymentIntent,
    'updateMany',
    () => true,
    async () => {
      await assert.rejects(
        () => cancelOrderWithCompensation(tenantId, s.orderId, 'x'),
        /"payments"/,
      )
    },
  )
  assert.equal(
    Number((await orderDb.order.findFirstOrThrow({ where: { id: s.orderId } })).amountPaid),
    100,
  )
  await cancelOrderWithCompensation(tenantId, s.orderId, 'x')
  assert.equal(
    Number((await orderDb.order.findFirstOrThrow({ where: { id: s.orderId } })).amountPaid),
    0,
  )
  assert.equal(
    Number(
      (await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: s.intentId } }))
        .refundedAmount,
    ),
    100,
  )
})

test('a crash after the refund but before it was recorded is not taken off amountPaid twice', async () => {
  const s = await seedPaid('100.00', '0', '100.00')
  await failOnce(
    orderDb.orderSaga,
    'update',
    (a: { data?: { compensations?: { cancel?: { steps?: Record<string, string> } } } }) =>
      a?.data?.compensations?.cancel?.steps?.payments === 'done',
    async () => {
      await assert.rejects(
        () => cancelOrderWithCompensation(tenantId, s.orderId, 'x'),
        /"payments"/,
      )
    },
  )
  assert.equal(
    Number(
      (await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: s.intentId } }))
        .refundedAmount,
    ),
    100,
  )
  await cancelOrderWithCompensation(tenantId, s.orderId, 'x')
  assert.equal(
    Number((await orderDb.order.findFirstOrThrow({ where: { id: s.orderId } })).amountPaid),
    0,
  )
})

test('an authorized hold is voided on cancel', async () => {
  const s = await seed()
  const intent = await paymentDb.paymentIntent.create({
    data: {
      tenantId,
      orderId: s.orderId,
      amount: '25.00',
      paymentMethod: 'CARD',
      status: 'AUTHORIZED',
      customerId,
      correlationId: randomUUID(),
      metadata: {},
    },
  })
  await cancelOrderWithCompensation(tenantId, s.orderId, 'x')
  assert.equal(
    (await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: intent.id } })).status,
    'VOIDED',
  )
})

test('an unpaid issued invoice is voided and its AR posting is reversed once', async () => {
  const s = await seed()
  const invoice = await orderDb.invoice.create({
    data: {
      tenantId,
      orderId: s.orderId,
      invoiceNumber: `INV-${randomUUID()}`,
      customerId,
      subtotal: '25.00',
      taxAmount: '0',
      totalAmount: '25.00',
      amountPaid: '0',
      status: 'ISSUED',
    },
  })
  await reconcileCancelledOrderInvoice(tenantId, s.orderId)
  await reconcileCancelledOrderInvoice(tenantId, s.orderId)
  const updated = await orderDb.invoice.findFirstOrThrow({ where: { id: invoice.id } })
  assert.equal(updated.status, 'VOID')
  assert.equal(Number(updated.amountCredited), 25)
  assert.equal(await orderDb.creditMemo.count({ where: { invoiceId: invoice.id } }), 1)
  assert.equal(
    await orderDb.postingJob.count({ where: { tenantId, kind: 'CREDIT_MEMO_JOURNAL' } }),
    1,
  )
})

test('a partially paid issued invoice is fully credited and marked credited idempotently', async () => {
  const s = await seed()
  const invoice = await orderDb.invoice.create({
    data: {
      tenantId,
      orderId: s.orderId,
      invoiceNumber: `INV-${randomUUID()}`,
      customerId,
      subtotal: '25.00',
      taxAmount: '0',
      totalAmount: '25.00',
      amountPaid: '10.00',
      status: 'PARTIALLY_PAID',
    },
  })
  await reconcileCancelledOrderInvoice(tenantId, s.orderId, 10)
  await reconcileCancelledOrderInvoice(tenantId, s.orderId)
  const updated = await orderDb.invoice.findFirstOrThrow({ where: { id: invoice.id } })
  assert.equal(updated.status, 'CREDITED')
  assert.equal(Number(updated.amountCredited), 25)
  assert.equal(await orderDb.creditMemo.count({ where: { invoiceId: invoice.id } }), 1)
  const memo = await orderDb.creditMemo.findFirstOrThrow({ where: { invoiceId: invoice.id } })
  const memoJob = await orderDb.postingJob.findFirstOrThrow({
    where: { tenantId, kind: 'CREDIT_MEMO_JOURNAL', sourceId: memo.id },
  })
  assert.equal((memoJob.payload as { cashAmount?: string }).cashAmount, '10.00')
})

test('cancelling a paid invoiced order posts one credit and refunds the captured card once', async () => {
  const s = await seedPaid('25.00', '0', '25.00')
  const invoice = await orderDb.invoice.create({
    data: {
      tenantId,
      orderId: s.orderId,
      invoiceNumber: `INV-${randomUUID()}`,
      customerId,
      subtotal: '25.00',
      taxAmount: '0',
      totalAmount: '25.00',
      amountPaid: '25.00',
      status: 'PAID',
    },
  })
  await cancelOrderWithCompensation(tenantId, s.orderId, 'approved buyer request')
  await cancelOrderWithCompensation(tenantId, s.orderId, 'approved buyer request')
  const updated = await orderDb.invoice.findFirstOrThrow({ where: { id: invoice.id } })
  assert.equal(updated.status, 'CREDITED')
  assert.equal(Number(updated.amountCredited), 25)
  assert.equal(await orderDb.creditMemo.count({ where: { invoiceId: invoice.id } }), 1)
  assert.equal(
    Number(
      (await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: s.intentId } }))
        .refundedAmount,
    ),
    25,
  )
  const memo = await orderDb.creditMemo.findFirstOrThrow({ where: { invoiceId: invoice.id } })
  const memoJob = await orderDb.postingJob.findFirstOrThrow({
    where: { tenantId, kind: 'CREDIT_MEMO_JOURNAL', sourceId: memo.id },
  })
  assert.equal((memoJob.payload as { cashAmount?: string }).cashAmount, '25.00')
})

test('paid card cancellation leaves cash, AR, and revenue ledger balances at zero', async () => {
  const s = await seedPaid('25.00', '0', '25.00')
  const invoice = await orderDb.invoice.create({
    data: {
      tenantId,
      orderId: s.orderId,
      invoiceNumber: `INV-${randomUUID()}`,
      customerId,
      subtotal: '25.00',
      taxAmount: '0',
      totalAmount: '25.00',
      amountPaid: '25.00',
      status: 'PAID',
    },
  })
  await ensurePostingAccounts(tenantId)
  await enqueuePostingJob(orderDb, {
    tenantId,
    kind: 'INVOICE_JOURNAL',
    sourceType: 'Invoice',
    sourceId: invoice.id,
    amount: '25.00',
  })
  await enqueuePostingJob(orderDb, {
    tenantId,
    kind: 'AR_PAYMENT_JOURNAL',
    sourceType: 'Invoice',
    sourceId: invoice.id,
    variant: `intent:${s.intentId}`,
    amount: '25.00',
  })
  const invoiceJob = await orderDb.postingJob.findFirstOrThrow({
    where: { tenantId, kind: 'INVOICE_JOURNAL', sourceId: invoice.id },
  })
  const paymentJob = await orderDb.postingJob.findFirstOrThrow({
    where: { tenantId, kind: 'AR_PAYMENT_JOURNAL', sourceId: invoice.id },
  })
  const invoiceEntry = await postJob(invoiceJob as never)
  const paymentEntry = await postJob(paymentJob as never)

  await cancelOrderWithCompensation(tenantId, s.orderId, 'accounting test')
  const memo = await orderDb.creditMemo.findFirstOrThrow({ where: { invoiceId: invoice.id } })
  const memoJob = await orderDb.postingJob.findFirstOrThrow({
    where: { tenantId, kind: 'CREDIT_MEMO_JOURNAL', sourceId: memo.id },
  })
  const memoEntry = await postJob(memoJob as never)
  const entries = await Promise.all(
    [invoiceEntry, paymentEntry, memoEntry].map((id) =>
      ledgerDb.journalEntry.findUniqueOrThrow({
        where: { id: id! },
        include: { lines: { include: { account: true } } },
      }),
    ),
  )
  const balances = new Map<string, number>()
  for (const entry of entries) {
    const debits = entry.lines.reduce((sum, line) => sum + Number(line.debit), 0)
    const credits = entry.lines.reduce((sum, line) => sum + Number(line.credit), 0)
    assert.equal(debits, credits, 'each posted journal is balanced')
    for (const line of entry.lines)
      balances.set(
        line.account.code,
        (balances.get(line.account.code) ?? 0) + Number(line.debit) - Number(line.credit),
      )
  }
  assert.equal(balances.get('1000'), 0, 'cash refund reverses the original cash receipt')
  assert.equal(balances.get('1200'), 0, 'AR is fully cleared')
  assert.equal(balances.get('4000'), 0, 'sales revenue is reversed')
  assert.equal(await orderDb.creditMemo.count({ where: { invoiceId: invoice.id } }), 1)
  assert.equal(
    await orderDb.postingJob.count({
      where: { tenantId, kind: 'CREDIT_MEMO_JOURNAL', sourceId: memo.id },
    }),
    1,
  )
})

test('unpaid and partially paid cancellations post balanced AR and cash credit treatment', async () => {
  await ensurePostingAccounts(tenantId)
  for (const paid of ['0.00', '10.00']) {
    const s = paid === '0.00' ? await seed() : await seedPaid(paid, '0', paid)
    const paymentIntentId = 'intentId' in s ? s.intentId : undefined
    const invoice = await orderDb.invoice.create({
      data: {
        tenantId,
        orderId: s.orderId,
        invoiceNumber: `INV-${randomUUID()}`,
        customerId,
        subtotal: '25.00',
        taxAmount: '0',
        totalAmount: '25.00',
        amountPaid: paid,
        status: paid === '0.00' ? 'ISSUED' : 'PARTIALLY_PAID',
      },
    })
    await enqueuePostingJob(orderDb, {
      tenantId,
      kind: 'INVOICE_JOURNAL',
      sourceType: 'Invoice',
      sourceId: invoice.id,
      amount: '25.00',
    })
    const invoiceJob = await orderDb.postingJob.findFirstOrThrow({
      where: { tenantId, kind: 'INVOICE_JOURNAL', sourceId: invoice.id },
    })
    const entryIds = [await postJob(invoiceJob as never)]
    if (paymentIntentId) {
      await enqueuePostingJob(orderDb, {
        tenantId,
        kind: 'AR_PAYMENT_JOURNAL',
        sourceType: 'Invoice',
        sourceId: invoice.id,
        variant: `intent:${paymentIntentId}`,
        amount: paid,
      })
      const paymentJob = await orderDb.postingJob.findFirstOrThrow({
        where: { tenantId, kind: 'AR_PAYMENT_JOURNAL', sourceId: invoice.id },
      })
      entryIds.push(await postJob(paymentJob as never))
    }

    await cancelOrderWithCompensation(tenantId, s.orderId, 'accounting test')
    const memo = await orderDb.creditMemo.findFirstOrThrow({ where: { invoiceId: invoice.id } })
    const memoJob = await orderDb.postingJob.findFirstOrThrow({
      where: { tenantId, kind: 'CREDIT_MEMO_JOURNAL', sourceId: memo.id },
    })
    entryIds.push(await postJob(memoJob as never))
    const entries = await Promise.all(
      entryIds.map((id) =>
        ledgerDb.journalEntry.findUniqueOrThrow({
          where: { id: id! },
          include: { lines: { include: { account: true } } },
        }),
      ),
    )
    const balances = new Map<string, number>()
    for (const entry of entries) {
      const debits = entry.lines.reduce((sum, line) => sum + Number(line.debit), 0)
      const credits = entry.lines.reduce((sum, line) => sum + Number(line.credit), 0)
      assert.equal(debits, credits)
      for (const line of entry.lines)
        balances.set(
          line.account.code,
          (balances.get(line.account.code) ?? 0) + Number(line.debit) - Number(line.credit),
        )
    }
    assert.equal(balances.get('1000') ?? 0, 0)
    assert.equal(balances.get('1200') ?? 0, 0)
    assert.equal(balances.get('4000') ?? 0, 0)
  }
})

test('PACKED transition and cancellation are mutually exclusive; packed winner is never refunded', async () => {
  const s = await seedPaid('25.00', '0', '25.00')
  const [cancel, packed] = await Promise.allSettled([
    cancelOrderWithCompensation(tenantId, s.orderId, 'race'),
    transitionOrderStatus(tenantId, s.orderId, 'PACKED'),
  ])
  const order = await orderDb.order.findFirstOrThrow({ where: { id: s.orderId } })
  const intent = await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: s.intentId } })
  if (order.status === 'PACKED') {
    assert.equal(packed.status, 'fulfilled')
    assert.equal(Number(intent.refundedAmount), 0)
    assert.equal(cancel.status, 'rejected')
  } else {
    assert.equal(order.status, 'CANCELLED')
    assert.equal(cancel.status, 'fulfilled')
    assert.equal(Number(intent.refundedAmount), 25)
    assert.equal(packed.status, 'rejected')
  }
})

test('the shared fulfillment lock protects pre-shipment effects through SHIPPED against cancellation', async () => {
  const s = await seedPaid('25.00', '0', '25.00')
  let enterFulfillment!: () => void
  let continueFulfillment!: () => void
  const entered = new Promise<void>((resolve) => (enterFulfillment = resolve))
  const blocked = new Promise<void>((resolve) => (continueFulfillment = resolve))
  const fulfillment = withOrderFulfillmentLock(tenantId, s.orderId, async () => {
    enterFulfillment()
    await blocked
    await transitionOrderStatus(tenantId, s.orderId, 'PACKED', undefined, { coordinationHeld: true })
    await transitionOrderStatus(tenantId, s.orderId, 'SHIPPED', undefined, { coordinationHeld: true })
  })
  await entered
  await assert.rejects(
    () => cancelOrderWithCompensation(tenantId, s.orderId, 'concurrent cancellation'),
    (err: unknown) => err instanceof ApiError && err.status === 409,
  )
  continueFulfillment()
  await fulfillment
  assert.equal((await orderDb.order.findFirstOrThrow({ where: { id: s.orderId } })).status, 'SHIPPED')
  assert.equal(Number((await paymentDb.paymentIntent.findFirstOrThrow({ where: { id: s.intentId } })).refundedAmount), 0)
})

test('CREDITED filtering includes cancelled orders and other status filters still exclude them', async () => {
  const s = await seed({ status: 'CANCELLED' })
  const invoice = await orderDb.invoice.create({
    data: {
      tenantId,
      orderId: s.orderId,
      invoiceNumber: `INV-${randomUUID()}`,
      customerId,
      subtotal: '25.00',
      taxAmount: '0',
      totalAmount: '25.00',
      amountCredited: '25.00',
      status: 'CREDITED',
    },
  })
  const credited = await listInvoices(tenantId, 1, 50, { status: 'CREDITED' })
  const issued = await listInvoices(tenantId, 1, 50, { status: 'ISSUED' })
  assert.ok(credited.items.some((item) => item.id === invoice.id))
  assert.ok(!issued.items.some((item) => item.id === invoice.id))
  await inventoryDb.stockReservation.deleteMany({ where: { tenantId, orderId: s.orderId } })
})

test('an order that has shipped cannot be cancelled, and nothing is undone', async () => {
  const s = await seed({ status: 'SHIPPED' })
  await assert.rejects(
    () => cancelOrderWithCompensation(tenantId, s.orderId, 'x'),
    (err: unknown) => err instanceof ApiError && err.status === 400,
  )
  assert.deepEqual((await state(s)).reservations, ['ACTIVE'])
})

test('a packed order is refused before cancellation side effects', async () => {
  const s = await seed({ status: 'PACKED', taskStatus: 'PACKED', picked: 5 })
  await assert.rejects(
    () => cancelOrderWithCompensation(tenantId, s.orderId, 'x'),
    (err: unknown) => err instanceof ApiError && err.status === 400,
  )
  assert.equal((await state(s)).status, 'PACKED')
  assert.deepEqual((await state(s)).reservations, ['ACTIVE'])
})

test('a cancel is refused with 409 while a dispatch holds a pre-pack task', async () => {
  const s = await seed({ status: 'PROCESSING', taskStatus: 'PICKING' })
  await wmsDb.fulfillmentTask.update({
    where: { id: s.taskId },
    data: { dispatchClaimedAt: new Date() },
  })
  await assert.rejects(
    () => cancelOrderWithCompensation(tenantId, s.orderId, 'x'),
    (err: unknown) => err instanceof ApiError && err.status === 409,
  )
  assert.equal((await state(s)).status, 'PROCESSING')
})

test('packing cannot advance a task while cancellation holds its fulfillment lease', async () => {
  const s = await seed({ status: 'PROCESSING', taskStatus: 'PICKING' })
  await wmsDb.fulfillmentTask.update({
    where: { id: s.taskId },
    data: { dispatchClaimedAt: new Date() },
  })
  await wmsDb.pickLine.updateMany({
    where: { taskId: s.taskId },
    data: { status: 'PICKED', pickedQty: 5 },
  })
  await assert.rejects(
    () => wmsFulfillment.markFulfillmentPacked(tenantId, s.taskId),
    (err: unknown) => err instanceof ApiError && err.status === 409,
  )
  assert.equal(
    (await wmsDb.fulfillmentTask.findFirstOrThrow({ where: { id: s.taskId } })).status,
    'PICKING',
  )
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

test(
  'cancel and dispatch together end in one consistent state',
  { skip: process.env.PLEROS_DB_PROVIDER !== 'postgres' },
  async () => {
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
        assert.equal(
          await orderDb.invoice.count({ where: { orderId: s.orderId } }),
          1,
          'shipped orders are invoiced',
        )
    } else {
      cancelled++
      assert.equal(st.status, 'CANCELLED')
      assert.deepEqual(st.reservations, ['RELEASED'])
      assert.equal(st.reserved, 0)
    }
  }
  assert.equal(shipped + cancelled, 15)
  },
)
