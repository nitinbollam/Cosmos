import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { inventoryDb, ledgerDb, orderDb } from './db'
import { adjustStock } from './inventory'
import { ensurePostingAccounts } from './ledger-posting'
import { postJob } from './posting-outbox'

async function seed(cost: number) {
  const tenantId = `t-${randomUUID()}`
  const skuId = randomUUID()
  const warehouseId = randomUUID()
  await ensurePostingAccounts(tenantId)
  await inventoryDb.sKU.create({
    data: { id: skuId, tenantId, code: `S-${skuId.slice(0, 6)}`, name: 'Pack', category: 'x', cost, price: 10, imageUrls: [], attributes: {} },
  })
  await inventoryDb.warehouse.create({
    data: { id: warehouseId, tenantId, name: 'W', code: `W-${warehouseId.slice(0, 6)}`, address: { state: 'FL' } },
  })
  await inventoryDb.stockLevel.create({
    data: { id: randomUUID(), tenantId, skuId, warehouseId, batchId: '', quantityOnHand: 20, quantityReserved: 0, quantityAvailable: 20 },
  })
  return { tenantId, skuId, warehouseId }
}

const jobsFor = (tenantId: string) => orderDb.postingJob.findMany({ where: { tenantId } })

async function entry(id: string) {
  return ledgerDb.journalEntry.findUniqueOrThrow({ where: { id }, include: { lines: { include: { account: true } } } })
}

test('a write-off posts shrinkage against inventory at cost, and the account is created on first use', async () => {
  const s = await seed(2.5)
  await adjustStock(s.tenantId, { skuId: s.skuId, warehouseId: s.warehouseId, quantityDelta: -4, reason: 'damaged', ledger: true }, 'u')
  const jobs = await jobsFor(s.tenantId)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].kind, 'STOCK_WRITE_OFF_JOURNAL')
  const id = (await postJob({ ...jobs[0], kind: 'STOCK_WRITE_OFF_JOURNAL' } as never))!
  const e = await entry(id)
  const dr = e.lines.find((l) => Number(l.debit) > 0)!
  const cr = e.lines.find((l) => Number(l.credit) > 0)!
  assert.equal(dr.account.code, '5100')
  assert.equal(cr.account.code, '1100')
  assert.equal(Number(dr.debit), 10)
  assert.equal(Number(cr.credit), 10)
})

test('units found reverse it, and an adjustment without the ledger option posts nothing', async () => {
  const s = await seed(3)
  await adjustStock(s.tenantId, { skuId: s.skuId, warehouseId: s.warehouseId, quantityDelta: 2, ledger: true }, 'u')
  await adjustStock(s.tenantId, { skuId: s.skuId, warehouseId: s.warehouseId, quantityDelta: -1 }, 'u')
  const jobs = await jobsFor(s.tenantId)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].kind, 'STOCK_FOUND_JOURNAL')
  const e = await entry((await postJob({ ...jobs[0], kind: 'STOCK_FOUND_JOURNAL' } as never))!)
  assert.equal(e.lines.find((l) => Number(l.debit) > 0)!.account.code, '1100')
  assert.equal(Number(e.lines.find((l) => Number(l.debit) > 0)!.debit), 6)
})

test('two adjustments that share a correlation id each get their own journal', async () => {
  const s = await seed(1)
  const correlationId = randomUUID()
  const other = randomUUID()
  await inventoryDb.sKU.create({
    data: { id: other, tenantId: s.tenantId, code: `S-${other.slice(0, 6)}`, name: 'P2', category: 'x', cost: 1, price: 2, imageUrls: [], attributes: {} },
  })
  await inventoryDb.stockLevel.create({
    data: { id: randomUUID(), tenantId: s.tenantId, skuId: other, warehouseId: s.warehouseId, batchId: '', quantityOnHand: 5, quantityReserved: 0, quantityAvailable: 5 },
  })
  await adjustStock(s.tenantId, { skuId: s.skuId, warehouseId: s.warehouseId, quantityDelta: -1, correlationId, ledger: true }, 'u')
  await adjustStock(s.tenantId, { skuId: other, warehouseId: s.warehouseId, quantityDelta: -1, correlationId, ledger: true }, 'u')
  assert.equal((await jobsFor(s.tenantId)).length, 2)
})
