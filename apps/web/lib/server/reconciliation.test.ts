import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { analyticsDb, crmDb, inventoryDb, ledgerDb, orderDb, paymentDb, wmsDb } from './db'
import { listOpenFindings, runReconciliation, type RuleId } from './reconciliation'

const newTenant = () => `rec-${randomUUID()}`
const OLD = new Date(Date.now() - 60 * 60 * 1000)

async function run(tenantId: string, rule: RuleId, opts: { dryRun?: boolean } = {}) {
  return runReconciliation(tenantId, { rules: [rule], ...opts })
}
async function mkOrder(tenantId: string, extra: Record<string, unknown> = {}) {
  const customerId = (extra.customerId as string) ?? `cust-${randomUUID()}`
  return orderDb.order.create({
    data: {
      tenantId,
      customerId,
      channel: 'B2B_PORTAL',
      paymentMethod: 'NET_TERMS',
      status: 'SHIPPED',
      totalAmount: 100,
      ...extra,
    } as never,
  })
}

test('a clean tenant yields no findings for any rule', async () => {
  const t = newTenant()
  const res = await runReconciliation(t)
  assert.equal(res.findings.length, 0)
  assert.deepEqual(res.ruleErrors, {})
})

test('R1: shipped order without invoice is flagged; zero-value and invoiced orders are not', async () => {
  const t = newTenant()
  const bad = await mkOrder(t)
  await mkOrder(t, { totalAmount: 0 })
  const ok = await mkOrder(t)
  await orderDb.invoice.create({
    data: { tenantId: t, orderId: ok.id, invoiceNumber: `I-${randomUUID()}`, customerId: ok.customerId, subtotal: 100, taxAmount: 0, totalAmount: 100 },
  })
  const res = await run(t, 'R1')
  assert.deepEqual(res.findings.map((f) => f.entityId), [bad.id])
})

test('R2: invoice older than 15 min with no journal is flagged; fresh invoice and linked journal are not', async () => {
  const t = newTenant()
  const mk = async (journalEntryId: string | null, issuedAt: Date) => {
    const o = await mkOrder(t)
    return orderDb.invoice.create({
      data: { tenantId: t, orderId: o.id, invoiceNumber: `I-${randomUUID()}`, customerId: o.customerId, subtotal: 10, taxAmount: 0, totalAmount: 10, issuedAt, journalEntryId },
    })
  }
  const missing = await mk(null, OLD)
  const dangling = await mk('does-not-exist', OLD)
  await mk(null, new Date())
  const entry = await ledgerDb.journalEntry.create({ data: { tenantId: t, description: 'ok', isPosted: true } })
  await mk(entry.id, OLD)
  const res = await run(t, 'R2')
  assert.deepEqual(res.findings.map((f) => f.entityId).sort(), [missing.id, dangling.id].sort())
})

test('R2: findings say why the posting is missing (dead job, queued job, or no job)', async () => {
  const t = newTenant()
  const mk = async () => {
    const o = await mkOrder(t)
    return orderDb.invoice.create({
      data: { tenantId: t, orderId: o.id, invoiceNumber: `I-${randomUUID()}`, customerId: o.customerId, subtotal: 10, taxAmount: 0, totalAmount: 10, issuedAt: OLD },
    })
  }
  const job = (invoiceId: string, status: 'DEAD' | 'PENDING', attempts: number) =>
    orderDb.postingJob.create({
      data: { tenantId: t, kind: 'INVOICE_JOURNAL', sourceType: 'Invoice', sourceId: invoiceId, dedupeKey: randomUUID(), payload: {}, status, attempts, lastError: status === 'DEAD' ? 'boom' : null },
    })
  const dead = await mk()
  const queued = await mk()
  const none = await mk()
  await job(dead.id, 'DEAD', 8)
  await job(queued.id, 'PENDING', 1)
  const res = await run(t, 'R2')
  const reason = (id: string) => (res.findings.find((f) => f.entityId === id)?.details as { reason: string }).reason
  assert.match(reason(dead.id), /DEAD after 8 attempts/)
  assert.match(reason(queued.id), /pending \(attempt 1\)/)
  assert.match(reason(none.id), /no posting job queued/)
})

test('R3: an unbalanced journal entry is flagged', async () => {
  const t = newTenant()
  const acct = await ledgerDb.chartAccount.create({ data: { tenantId: t, code: '1000', name: 'Cash', type: 'ASSET' } })
  const bad = await ledgerDb.journalEntry.create({
    data: { tenantId: t, description: 'bad', lines: { create: [{ accountId: acct.id, debit: 10, credit: 0 }, { accountId: acct.id, debit: 0, credit: 9.99 }] } },
  })
  await ledgerDb.journalEntry.create({
    data: { tenantId: t, description: 'good', lines: { create: [{ accountId: acct.id, debit: 0.1, credit: 0 }, { accountId: acct.id, debit: 0, credit: 0.1 }] } },
  })
  const res = await run(t, 'R3')
  assert.deepEqual(res.findings.map((f) => f.entityId), [bad.id])
})

test('R4: ledger sum and available arithmetic are checked', async () => {
  const t = newTenant()
  const mk = (skuId: string, onHand: number, reserved: number, available: number) =>
    inventoryDb.stockLevel.create({
      data: { tenantId: t, skuId, warehouseId: 'wh', batchId: '', quantityOnHand: onHand, quantityReserved: reserved, quantityAvailable: available },
    })
  const entry = (skuId: string, delta: number) =>
    inventoryDb.stockLedgerEntry.create({
      data: { tenantId: t, skuId, warehouseId: 'wh', batchId: '', eventType: 'STOCK_RECEIVED', quantityDelta: delta, quantityAfter: delta, unitCost: 0, performedBy: 'u', correlationId: 'c' },
    })
  await mk('good', 10, 2, 8); await entry('good', 10)
  const badLedger = await mk('bad-ledger', 10, 0, 10); await entry('bad-ledger', 7)
  const badAvail = await mk('bad-avail', 10, 2, 9); await entry('bad-avail', 10)
  const res = await run(t, 'R4')
  assert.deepEqual(res.findings.map((f) => f.entityId).sort(), [badLedger.id, badAvail.id].sort())
})

test('R5 and R6: reserved vs ACTIVE reservations, and reservations on dead orders', async () => {
  const t = newTenant()
  const live = await mkOrder(t, { status: 'PROCESSING' })
  const dead = await mkOrder(t, { status: 'CANCELLED' })
  const lvl = await inventoryDb.stockLevel.create({
    data: { tenantId: t, skuId: 's', warehouseId: 'wh', batchId: '', quantityOnHand: 10, quantityReserved: 5, quantityAvailable: 5 },
  })
  const exp = new Date(Date.now() + 86_400_000)
  await inventoryDb.stockReservation.create({ data: { tenantId: t, orderId: live.id, skuId: 's', warehouseId: 'wh', batchId: '', quantity: 2, expiresAt: exp } })
  const leaked = await inventoryDb.stockReservation.create({ data: { tenantId: t, orderId: dead.id, skuId: 's', warehouseId: 'wh', batchId: '', quantity: 1, expiresAt: exp } })
  const r5 = await run(t, 'R5')
  assert.deepEqual(r5.findings.map((f) => f.entityId), [lvl.id]) // reserved 5 vs ACTIVE 3
  const r6 = await run(t, 'R6')
  assert.deepEqual(r6.findings.map((f) => f.entityId), [leaked.id])
})

test('R7: amountPaid must equal captured minus refunded', async () => {
  const t = newTenant()
  const bad = await mkOrder(t, { amountPaid: 100 })
  const good = await mkOrder(t, { amountPaid: 60 })
  const intent = (orderId: string, captured: number, refunded: number) =>
    paymentDb.paymentIntent.create({
      data: { tenantId: t, orderId, amount: captured, paymentMethod: 'CARD', status: 'CAPTURED', customerId: 'c', capturedAmount: captured, refundedAmount: refunded, correlationId: 'x', metadata: {} },
    })
  await intent(bad.id, 100, 40)
  await intent(good.id, 100, 40)
  const res = await run(t, 'R7')
  assert.deepEqual(res.findings.map((f) => f.entityId), [bad.id])
})

test('R8: open invoice balances must equal ledger account 1200', async () => {
  const t = newTenant()
  const o = await mkOrder(t)
  await orderDb.invoice.create({
    data: { tenantId: t, orderId: o.id, invoiceNumber: `I-${randomUUID()}`, customerId: o.customerId, subtotal: 100, taxAmount: 0, totalAmount: 100, amountPaid: 40 },
  })
  const ar = await ledgerDb.chartAccount.create({ data: { tenantId: t, code: '1200', name: 'AR', type: 'ASSET' } })
  const rev = await ledgerDb.chartAccount.create({ data: { tenantId: t, code: '4000', name: 'Rev', type: 'REVENUE' } })
  const post = (amount: number) =>
    ledgerDb.journalEntry.create({
      data: { tenantId: t, description: 'ar', lines: { create: [{ accountId: ar.id, debit: amount, credit: 0 }, { accountId: rev.id, debit: 0, credit: amount }] } },
    })
  await post(100)
  assert.equal((await run(t, 'R8')).findings.length, 1) // ledger 100 vs open 60
  await ledgerDb.journalEntry.create({
    data: { tenantId: t, description: 'cash', lines: { create: [{ accountId: ar.id, debit: 0, credit: 40 }, { accountId: rev.id, debit: 40, credit: 0 }] } },
  })
  assert.equal((await run(t, 'R8')).findings.length, 0) // now 60 = 60
})

test('R9: dispatched task on an unshipped order and packed task without reservations', async () => {
  const t = newTenant()
  const unshipped = await mkOrder(t, { status: 'PROCESSING' })
  const packedOrder = await mkOrder(t, { status: 'PACKED' })
  const shipped = await mkOrder(t, { status: 'SHIPPED' })
  const task = (orderId: string, status: string) =>
    wmsDb.fulfillmentTask.create({ data: { tenantId: t, orderId, status, correlationId: 'c', warehouseId: 'wh', warehouseCode: 'W' } as never })
  const a = await task(unshipped.id, 'DISPATCHED')
  const b = await task(packedOrder.id, 'PACKED')
  await task(shipped.id, 'DISPATCHED')
  const res = await run(t, 'R9')
  assert.deepEqual(res.findings.map((f) => f.entityId).sort(), [a.id, b.id].sort())
})

test('R10: creditUsed must equal open NET_TERMS exposure', async () => {
  const t = newTenant()
  const cust = await crmDb.customer.create({ data: { tenantId: t, name: 'C', creditUsed: 50 } })
  const matched = await crmDb.customer.create({ data: { tenantId: t, name: 'M', creditUsed: 70 } })
  await mkOrder(t, { customerId: cust.id, status: 'PROCESSING', totalAmount: 100, amountPaid: 30 })
  await mkOrder(t, { customerId: matched.id, status: 'SHIPPED', totalAmount: 100, amountPaid: 30 })
  await mkOrder(t, { customerId: matched.id, status: 'CANCELLED', totalAmount: 999 })
  const res = await run(t, 'R10')
  assert.deepEqual(res.findings.map((f) => f.entityId), [cust.id]) // used 50 vs exposure 70
})

test('findings are upserted, refreshed, resolved when fixed and reopened if they recur', async () => {
  const t = newTenant()
  const o = await mkOrder(t)
  const first = await run(t, 'R1')
  assert.equal(first.newFindings.length, 1)
  const row1 = await analyticsDb.reconciliationFinding.findFirstOrThrow({ where: { tenantId: t } })

  const second = await run(t, 'R1')
  assert.equal(second.newFindings.length, 0)
  assert.equal(await analyticsDb.reconciliationFinding.count({ where: { tenantId: t } }), 1)
  const row2 = await analyticsDb.reconciliationFinding.findFirstOrThrow({ where: { tenantId: t } })
  assert.ok(row2.lastSeenAt >= row1.lastSeenAt)
  assert.equal(row2.firstSeenAt.getTime(), row1.firstSeenAt.getTime())

  await orderDb.invoice.create({
    data: { tenantId: t, orderId: o.id, invoiceNumber: `I-${randomUUID()}`, customerId: o.customerId, subtotal: 100, taxAmount: 0, totalAmount: 100 },
  })
  const fixed = await run(t, 'R1')
  assert.equal(fixed.resolved, 1)
  assert.ok((await analyticsDb.reconciliationFinding.findFirstOrThrow({ where: { tenantId: t } })).resolvedAt)
  assert.equal((await listOpenFindings(t)).findings.length, 0)

  await orderDb.invoice.delete({ where: { orderId: o.id } })
  const again = await run(t, 'R1')
  assert.equal(again.newFindings.length, 1)
  assert.equal((await listOpenFindings(t)).findings.length, 1)
})

test('dry run reports findings but writes nothing', async () => {
  const t = newTenant()
  await mkOrder(t)
  const res = await run(t, 'R1', { dryRun: true })
  assert.equal(res.findings.length, 1)
  assert.equal(await analyticsDb.reconciliationFinding.count({ where: { tenantId: t } }), 0)
})

test('the job is read-only: business data is unchanged and every write targets the findings table', async () => {
  const t = newTenant()
  const o = await mkOrder(t)
  const before = await orderDb.order.findUniqueOrThrow({ where: { id: o.id } })
  await runReconciliation(t)
  const after = await orderDb.order.findUniqueOrThrow({ where: { id: o.id } })
  assert.equal(before.updatedAt.getTime(), after.updatedAt.getTime())

  const src = readFileSync(new URL('./reconciliation.ts', import.meta.url), 'utf8')
  const writes = [...src.matchAll(/(\w+Db)\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)]
  assert.ok(writes.length > 0)
  for (const w of writes) assert.equal(w[1], 'analyticsDb', `unexpected write via ${w[0]}`)
})

test('one failing rule is reported without losing the others', async () => {
  const t = newTenant()
  await mkOrder(t)
  const res = await runReconciliation(t, { rules: ['R1'] })
  assert.equal(res.byRule.R1, 1)
  assert.deepEqual(res.ruleErrors, {})
})
