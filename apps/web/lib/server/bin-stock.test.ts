import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import { Prisma } from '@/generated/prisma-inventory'
import { inventoryDb, wmsDb } from './db'
import { binReductions, moveToBin, unbinnedQuantity } from './bin-stock'
import { commitShipmentForOrder, receiveStock } from './inventory'
import { confirmPutawayLine, createPutawayTaskFromReceiving } from './wms-putaway'

const tenantId = `t-${randomUUID()}`

after(async () => {
  await wmsDb.putawayTask.deleteMany({ where: { tenantId } })
  await wmsDb.wmsLaborEvent.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId } })
  await inventoryDb.stockReservation.deleteMany({ where: { tenantId } })
  await inventoryDb.binStock.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.binLocation.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId } })
})

test('unbinned stock is what no bin holds, never negative', () => {
  assert.equal(unbinnedQuantity(30, [{ quantity: 10 }, { quantity: 5 }]), 15)
  assert.equal(unbinnedQuantity(3, [{ quantity: 10 }]), 0)
})

test('stock leaving the warehouse comes out of unbinned stock first, then the pick bin, then the fullest bin', () => {
  const bins = [
    { binId: 'A', quantity: 10 },
    { binId: 'B', quantity: 20 },
    { binId: 'C', quantity: 5 },
  ]
  assert.deepEqual(binReductions(40, bins, 'A'), [], 'enough unbinned stock covers it')
  assert.deepEqual(binReductions(30, bins, 'A'), [{ binId: 'A', take: 5 }])
  assert.deepEqual(binReductions(20, bins, 'A'), [{ binId: 'A', take: 10 }, { binId: 'B', take: 5 }])
  assert.deepEqual(binReductions(0, bins, null), [{ binId: 'B', take: 20 }, { binId: 'A', take: 10 }, { binId: 'C', take: 5 }])
})

async function setup() {
  const wh = await inventoryDb.warehouse.create({ data: { tenantId, name: 'W', code: `W-${randomUUID().slice(0, 4)}`, address: {} } })
  const sku = await inventoryDb.sKU.create({
    data: { tenantId, code: `S-${randomUUID().slice(0, 6)}`, name: 'Widget', category: 'X', cost: new Prisma.Decimal('2'), price: new Prisma.Decimal('5'), imageUrls: [], attributes: {} },
  })
  const [a1, b2] = await Promise.all(
    ['A-01', 'B-02'].map((code) => inventoryDb.binLocation.create({ data: { tenantId, warehouseId: wh.id, code } })),
  )
  return { wh, sku, a1, b2 }
}

const binQty = async (skuId: string, binId: string) =>
  (await inventoryDb.binStock.findFirst({ where: { tenantId, skuId, binId } }))?.quantity ?? 0

test('putting away 10 moves exactly 10 into the bin, leaves the rest where it was, and is recorded once', async () => {
  const { wh, sku, a1, b2 } = await setup()
  // 25 already on hand and 10 of them already in B-02.
  await receiveStock(tenantId, { skuId: sku.id, warehouseId: wh.id, quantity: 25, unitCost: 2 }, 'test')
  await moveToBin(tenantId, { skuId: sku.id, warehouseId: wh.id, toBinId: b2.id, quantity: 10, referenceType: 'TEST', performedBy: 'test' })

  // A new receipt of 10 creates its putaway task.
  await receiveStock(tenantId, { skuId: sku.id, warehouseId: wh.id, quantity: 10, unitCost: 2 }, 'test')
  const task = await createPutawayTaskFromReceiving(tenantId, `rs-${randomUUID()}`, wh.id, [{ skuId: sku.id, quantity: 10 }])
  const line = task.lines[0]

  const res = await confirmPutawayLine(tenantId, task.id, line.id, { actualBinId: a1.id, performedBy: 'test' })
  assert.equal(res.moved, 10)
  assert.equal(res.binCode, 'A-01')
  assert.equal(await binQty(sku.id, a1.id), 10)
  assert.equal(await binQty(sku.id, b2.id), 10, 'the other bin is untouched')
  const level = await inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId: sku.id, warehouseId: wh.id } })
  assert.equal(level.quantityOnHand, 35, 'a move does not change the total')
  assert.equal(level.locationId, b2.id, 'putaway no longer re-points the whole stock level at the new bin')

  const moves = await inventoryDb.stockLedgerEntry.findMany({
    where: { tenantId, skuId: sku.id, eventType: 'STOCK_MOVED', referenceId: line.id },
    orderBy: { quantityDelta: 'asc' },
  })
  assert.deepEqual(moves.map((m) => [m.quantityDelta, m.locationId]), [[-10, null], [10, a1.id]])

  // Confirming again (double tap, retry) moves nothing more.
  const again = await confirmPutawayLine(tenantId, task.id, line.id, { actualBinId: a1.id, performedBy: 'test' })
  assert.equal(again.moved, 0)
  assert.equal(await binQty(sku.id, a1.id), 10)
  assert.equal(await inventoryDb.stockLedgerEntry.count({ where: { tenantId, referenceId: line.id } }), 2)
  assert.equal((await wmsDb.putawayTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'COMPLETED')
})

test('a putaway is refused for a bin in another warehouse or with nothing chosen', async () => {
  const { wh, sku } = await setup()
  const other = await setup()
  await receiveStock(tenantId, { skuId: sku.id, warehouseId: wh.id, quantity: 4, unitCost: 2 }, 'test')
  const task = await createPutawayTaskFromReceiving(tenantId, `rs-${randomUUID()}`, wh.id, [{ skuId: sku.id, quantity: 4 }])
  await assert.rejects(
    confirmPutawayLine(tenantId, task.id, task.lines[0].id, { actualBinId: other.a1.id, performedBy: 'test' }),
    (e: { status?: number }) => e.status === 400,
  )
  await assert.rejects(
    moveToBin(tenantId, { skuId: sku.id, warehouseId: wh.id, toBinId: other.a1.id, quantity: 1, referenceType: 'TEST', performedBy: 'test' }),
    (e: { status?: number }) => e.status === 400,
  )
})

test('moving more than a bin holds is refused; shipped units leave the bins', async () => {
  const { wh, sku, a1, b2 } = await setup()
  await receiveStock(tenantId, { skuId: sku.id, warehouseId: wh.id, quantity: 12, unitCost: 2 }, 'test')
  await moveToBin(tenantId, { skuId: sku.id, warehouseId: wh.id, toBinId: a1.id, quantity: 12, referenceType: 'TEST', performedBy: 'test' })
  await assert.rejects(
    moveToBin(tenantId, { skuId: sku.id, warehouseId: wh.id, fromBinId: a1.id, toBinId: b2.id, quantity: 13, referenceType: 'TEST', performedBy: 'test' }),
    (e: { status?: number }) => e.status === 409,
  )
  await moveToBin(tenantId, { skuId: sku.id, warehouseId: wh.id, fromBinId: a1.id, toBinId: b2.id, quantity: 5, referenceType: 'TEST', performedBy: 'test' })
  assert.deepEqual([await binQty(sku.id, a1.id), await binQty(sku.id, b2.id)], [7, 5])

  const orderId = `ord-${randomUUID()}`
  await inventoryDb.stockLevel.updateMany({
    where: { tenantId, skuId: sku.id, warehouseId: wh.id },
    data: { quantityReserved: { increment: 9 }, quantityAvailable: { decrement: 9 } },
  })
  await inventoryDb.stockReservation.create({
    data: { id: randomUUID(), tenantId, orderId, skuId: sku.id, warehouseId: wh.id, batchId: '', quantity: 9, status: 'ACTIVE', expiresAt: new Date(Date.now() + 86_400_000) },
  })
  await commitShipmentForOrder(tenantId, orderId, 'test')
  // 3 left on hand: the pick bin (A-01, the first bin used) gives up its 7 first, then B-02 gives 2.
  assert.deepEqual([await binQty(sku.id, a1.id), await binQty(sku.id, b2.id)], [0, 3])
})

test('a warehouse with no bins can still finish putaway; nothing moves', async () => {
  const wh = await inventoryDb.warehouse.create({ data: { tenantId, name: 'NoBins', code: `N-${randomUUID().slice(0, 4)}`, address: {} } })
  const sku = await inventoryDb.sKU.create({
    data: { tenantId, code: `S-${randomUUID().slice(0, 6)}`, name: 'W', category: 'X', cost: new Prisma.Decimal('2'), price: new Prisma.Decimal('5'), imageUrls: [], attributes: {} },
  })
  await receiveStock(tenantId, { skuId: sku.id, warehouseId: wh.id, quantity: 3, unitCost: 2 }, 'test')
  const task = await createPutawayTaskFromReceiving(tenantId, `rs-${randomUUID()}`, wh.id, [{ skuId: sku.id, quantity: 3 }])
  const res = await confirmPutawayLine(tenantId, task.id, task.lines[0].id, { performedBy: 'test' })
  assert.equal(res.moved, 0)
  assert.equal((await wmsDb.putawayTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'COMPLETED')
  assert.equal(await inventoryDb.binStock.count({ where: { tenantId, skuId: sku.id } }), 0)
})
