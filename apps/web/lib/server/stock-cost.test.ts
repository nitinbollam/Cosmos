import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import { Prisma } from '@/generated/prisma-inventory'
import { inventoryDb } from './db'
import {
  adjustStock,
  commitShipmentForOrder,
  orderShippedUnitCosts,
  receiveStock,
  transferStock,
} from './inventory'
import { blendAverage, effectiveUnitCost, shippedUnitCosts, valueOf } from './stock-cost'

const tenantId = `t-${randomUUID()}`

after(async () => {
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId } })
  await inventoryDb.stockReservation.deleteMany({ where: { tenantId } })
  await inventoryDb.shipmentCommit.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId } })
})

test('the average blends receipts by quantity; empty stock takes the new cost', () => {
  assert.equal(blendAverage(10, '4', 30, '8'), '7')
  assert.equal(blendAverage(0, '99', 5, '3.25'), '3.25')
  assert.equal(blendAverage(-2, '5', 5, '3'), '3', 'oversold stock does not drag the new average')
  assert.equal(blendAverage(3, '1', 0, '9'), '1')
  assert.equal(blendAverage(3, '1', 1, '2'), '1.25')
  assert.equal(blendAverage(2, '1', 1, '2'), '1.3333')
})

test('stock with no average is valued at the standard cost, explicitly', () => {
  assert.equal(effectiveUnitCost(null, '5.5'), '5.5')
  assert.equal(effectiveUnitCost('4.12345', '5.5'), '4.1235')
  assert.equal(effectiveUnitCost(null, null), '0')
})

test('values round to cents once, after adding', () => {
  assert.equal(valueOf([{ quantity: 3, unitCost: '1.3333' }, { quantity: 3, unitCost: '1.3333' }]).toFixed(2), '8.00')
})

test('an order’s shipped cost is weighted by quantity; unvalued (legacy 0) rows fall back to standard cost', () => {
  const costs = shippedUnitCosts(
    [
      { skuId: 'a', quantityDelta: -10, unitCost: '7' },
      { skuId: 'a', quantityDelta: -5, unitCost: '4' },
      { skuId: 'b', quantityDelta: -3, unitCost: '0' },
    ],
    new Map([['a', '1'], ['b', '2.5']]),
    ['a', 'b', 'c'],
  )
  assert.equal(costs.get('a'), '6')
  assert.equal(costs.get('b'), '2.5')
  assert.equal(costs.get('c'), '0')
})

async function sku(cost: string) {
  return inventoryDb.sKU.create({
    data: { tenantId, code: `S-${randomUUID().slice(0, 6)}`, name: 'Widget', category: 'X', cost: new Prisma.Decimal(cost), price: new Prisma.Decimal('20'), imageUrls: [], attributes: {} },
  })
}
async function warehouse() {
  return inventoryDb.warehouse.create({ data: { tenantId, name: 'W', code: `W-${randomUUID().slice(0, 4)}`, address: {} } })
}
async function reserveAndShip(skuId: string, warehouseId: string, quantity: number) {
  const orderId = `ord-${randomUUID()}`
  await inventoryDb.stockLevel.updateMany({
    where: { tenantId, skuId, warehouseId },
    data: { quantityReserved: { increment: quantity }, quantityAvailable: { decrement: quantity } },
  })
  await inventoryDb.stockReservation.create({
    data: { id: randomUUID(), tenantId, orderId, skuId, warehouseId, batchId: '', quantity, status: 'ACTIVE', expiresAt: new Date(Date.now() + 86_400_000) },
  })
  return { orderId, ...(await commitShipmentForOrder(tenantId, orderId, 'test')) }
}
const level = (skuId: string, warehouseId: string) => inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId, warehouseId } })

test('receipts at different costs, partial shipments and a transfer are valued at the moving average', async () => {
  const s = await sku('5') // standard cost differs from what was paid
  const w1 = await warehouse()
  const w2 = await warehouse()
  await receiveStock(tenantId, { skuId: s.id, warehouseId: w1.id, quantity: 10, unitCost: 4 }, 'test')
  await receiveStock(tenantId, { skuId: s.id, warehouseId: w1.id, quantity: 30, unitCost: 8 }, 'test')
  assert.equal((await level(s.id, w1.id)).averageCost?.toString(), '7')

  const first = await reserveAndShip(s.id, w1.id, 15)
  assert.deepEqual(first.shipped.map((l) => [l.quantity, l.unitCost]), [[15, '7']])
  const ledger = await inventoryDb.stockLedgerEntry.findFirstOrThrow({ where: { tenantId, referenceId: first.orderId, eventType: 'STOCK_SHIPPED' } })
  assert.equal(ledger.unitCost.toString(), '7')
  // The COGS journal is the shipment's ledger value, not the SKU's standard cost (15 × 5 = 75).
  assert.equal(valueOf(first.shipped.map((l) => ({ quantity: l.quantity, unitCost: l.unitCost! }))).toFixed(2), '105.00')

  await transferStock(tenantId, { skuId: s.id, fromWarehouseId: w1.id, toWarehouseId: w2.id, quantity: 10 }, 'test')
  const moves = await inventoryDb.stockLedgerEntry.findMany({ where: { tenantId, skuId: s.id, eventType: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] } } })
  assert.deepEqual(moves.map((m) => m.unitCost.toString()), ['7', '7'])
  await receiveStock(tenantId, { skuId: s.id, warehouseId: w2.id, quantity: 10, unitCost: 3 }, 'test')
  assert.equal((await level(s.id, w2.id)).averageCost?.toString(), '5')

  const second = await reserveAndShip(s.id, w2.id, 4)
  assert.equal(second.shipped[0].unitCost, '5')
  assert.equal((await level(s.id, w1.id)).quantityOnHand, 15)
})

test('legacy stock with no average ships at standard cost; a return comes back at the cost it shipped at', async () => {
  const s = await sku('6')
  const w = await warehouse()
  await inventoryDb.stockLevel.create({
    data: { tenantId, skuId: s.id, warehouseId: w.id, batchId: '', quantityOnHand: 10, quantityAvailable: 10 },
  })
  const legacy = await reserveAndShip(s.id, w.id, 2)
  assert.equal(legacy.shipped[0].unitCost, '6')

  await receiveStock(tenantId, { skuId: s.id, warehouseId: w.id, quantity: 8, unitCost: 12 }, 'test')
  // 8 on hand at standard 6 + 8 at 12 → 9
  assert.equal((await level(s.id, w.id)).averageCost?.toString(), '9')
  const sold = await reserveAndShip(s.id, w.id, 4)
  assert.equal(sold.shipped[0].unitCost, '9')

  const costs = await orderShippedUnitCosts(tenantId, sold.orderId, [s.id])
  assert.equal(costs.get(s.id), '9')
  // A cheaper receipt moves the average, then 2 units come back at 9, not at the new average.
  await receiveStock(tenantId, { skuId: s.id, warehouseId: w.id, quantity: 12, unitCost: 1 }, 'test')
  const before = await level(s.id, w.id)
  await adjustStock(tenantId, { skuId: s.id, warehouseId: w.id, quantityDelta: 2, unitCost: costs.get(s.id), referenceType: 'CREDIT_MEMO' }, 'test')
  const returned = await inventoryDb.stockLedgerEntry.findFirstOrThrow({ where: { tenantId, skuId: s.id, referenceType: 'CREDIT_MEMO' } })
  assert.equal(returned.unitCost.toString(), '9')
  const afterReturn = await level(s.id, w.id)
  const expected = blendAverage(before.quantityOnHand, before.averageCost!.toString(), 2, '9')
  assert.equal(afterReturn.averageCost?.toString(), expected)

  // A count write-off is valued at the average and leaves it unchanged.
  await adjustStock(tenantId, { skuId: s.id, warehouseId: w.id, quantityDelta: -1, referenceType: 'COUNT' }, 'test')
  const writeOff = await inventoryDb.stockLedgerEntry.findFirstOrThrow({ where: { tenantId, skuId: s.id, referenceType: 'COUNT' } })
  assert.equal(writeOff.unitCost.toString(), expected)
  assert.equal((await level(s.id, w.id)).averageCost?.toString(), expected)
})

test('a receipt with no known cost comes in at the current cost instead of dragging the average to $0', async () => {
  const s = await sku('5')
  const w = await warehouse()
  await receiveStock(tenantId, { skuId: s.id, warehouseId: w.id, quantity: 10, unitCost: 4 }, 'test')
  await receiveStock(tenantId, { skuId: s.id, warehouseId: w.id, quantity: 30, unitCost: 8 }, 'test')
  await receiveStock(tenantId, { skuId: s.id, warehouseId: w.id, quantity: 10, unitCost: null }, 'test')
  assert.equal((await level(s.id, w.id)).averageCost?.toString(), '7')
  const last = await inventoryDb.stockLedgerEntry.findFirstOrThrow({ where: { tenantId, skuId: s.id, eventType: 'STOCK_RECEIVED' }, orderBy: { occurredAt: 'desc' } })
  assert.equal(last.unitCost.toString(), '7')
  const fresh = await sku('6')
  await receiveStock(tenantId, { skuId: fresh.id, warehouseId: w.id, quantity: 2 }, 'test')
  assert.equal((await level(fresh.id, w.id)).averageCost?.toString(), '6', 'first receipt with no cost uses the standard cost')
})

test('an adjustment on stock with no average keeps following the standard cost', async () => {
  const s = await sku('3')
  const w = await warehouse()
  await inventoryDb.stockLevel.create({ data: { tenantId, skuId: s.id, warehouseId: w.id, batchId: '', quantityOnHand: 5, quantityAvailable: 5 } })
  await adjustStock(tenantId, { skuId: s.id, warehouseId: w.id, quantityDelta: 3 }, 'test')
  assert.equal((await level(s.id, w.id)).averageCost, null)
  const entry = await inventoryDb.stockLedgerEntry.findFirstOrThrow({ where: { tenantId, skuId: s.id, eventType: 'STOCK_ADJUSTED' } })
  assert.equal(entry.unitCost.toString(), '3')
})
