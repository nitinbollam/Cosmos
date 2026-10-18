import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { inventoryDb } from './db'
import { adjustStock, commitShipmentForOrder, transferStock } from './inventory'
import { ApiError } from './session'

async function seedLevel(tenantId: string, onHand: number, reserved = 0) {
  const skuId = `sku-${randomUUID()}`
  const warehouseId = `wh-${randomUUID()}`
  await inventoryDb.stockLevel.create({
    data: {
      tenantId,
      skuId,
      warehouseId,
      batchId: '',
      quantityOnHand: onHand,
      quantityReserved: reserved,
      quantityAvailable: onHand - reserved,
    },
  })
  return { skuId, warehouseId }
}

async function reserve(tenantId: string, orderId: string, skuId: string, warehouseId: string, quantity: number) {
  await inventoryDb.stockReservation.create({
    data: { id: randomUUID(), tenantId, orderId, skuId, warehouseId, batchId: '', quantity, status: 'ACTIVE', expiresAt: new Date(Date.now() + 86_400_000) },
  })
}

// SQLite serialises writers and times out a deep queue of interactive transactions, so local runs
// use fewer; Postgres (the real race) runs the full 50.
const N = process.env.PLEROS_DB_PROVIDER === 'postgres' ? 50 : 10

test('concurrent shipments never lose a decrement', async () => {
  const tenantId = `t-${randomUUID()}`
  const { skuId, warehouseId } = await seedLevel(tenantId, N * 2, N)
  const orders = Array.from({ length: N }, () => `ord-${randomUUID()}`)
  for (const o of orders) await reserve(tenantId, o, skuId, warehouseId, 1)

  await Promise.all(orders.map((o) => commitShipmentForOrder(tenantId, o, 'test')))

  const level = await inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId, warehouseId } })
  assert.equal(level.quantityOnHand, N)
  assert.equal(level.quantityReserved, 0)
  assert.equal(level.quantityAvailable, level.quantityOnHand - level.quantityReserved)

  const ledger = await inventoryDb.stockLedgerEntry.findMany({
    where: { tenantId, skuId, eventType: 'STOCK_SHIPPED' },
  })
  assert.equal(ledger.length, N)
  assert.equal(ledger.reduce((s, r) => s + r.quantityDelta, 0), -N)
  assert.equal(new Set(ledger.map((r) => r.quantityAfter)).size, N, 'quantityAfter must be unique per row')
})

test('shipping more than on hand fails with 409 and changes nothing', async () => {
  const tenantId = `t-${randomUUID()}`
  const { skuId, warehouseId } = await seedLevel(tenantId, 3, 5)
  const orderId = `ord-${randomUUID()}`
  await reserve(tenantId, orderId, skuId, warehouseId, 5)

  await assert.rejects(
    () => commitShipmentForOrder(tenantId, orderId, 'test'),
    (e: unknown) => e instanceof ApiError && e.status === 409,
  )

  const level = await inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId, warehouseId } })
  assert.equal(level.quantityOnHand, 3)
  assert.equal(level.quantityReserved, 5)
  const res = await inventoryDb.stockReservation.findFirstOrThrow({ where: { tenantId, orderId } })
  assert.equal(res.status, 'ACTIVE')
  assert.equal(await inventoryDb.stockLedgerEntry.count({ where: { tenantId, skuId } }), 0)
})

test('a missing stock level fails the transaction instead of fulfilling the reservation', async () => {
  const tenantId = `t-${randomUUID()}`
  const orderId = `ord-${randomUUID()}`
  await reserve(tenantId, orderId, `sku-${randomUUID()}`, `wh-${randomUUID()}`, 2)

  await assert.rejects(
    () => commitShipmentForOrder(tenantId, orderId, 'test'),
    (e: unknown) => e instanceof ApiError && e.status === 409,
  )
  const res = await inventoryDb.stockReservation.findFirstOrThrow({ where: { tenantId, orderId } })
  assert.equal(res.status, 'ACTIVE')
})

test('a partial pick returns the unshipped remainder to availability', async () => {
  const tenantId = `t-${randomUUID()}`
  const { skuId, warehouseId } = await seedLevel(tenantId, 10, 4)
  const orderId = `ord-${randomUUID()}`
  await reserve(tenantId, orderId, skuId, warehouseId, 4)

  const { shipped } = await commitShipmentForOrder(tenantId, orderId, 'test', [
    { skuId, warehouseId, batchId: '', quantity: 3 },
  ])
  assert.equal(shipped[0].quantity, 3)
  const level = await inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId, warehouseId } })
  assert.equal(level.quantityOnHand, 7)
  assert.equal(level.quantityReserved, 0)
  assert.equal(level.quantityAvailable, 7)
})

test('concurrent transfers out of one level never oversell the source', async () => {
  const tenantId = `t-${randomUUID()}`
  const { skuId, warehouseId } = await seedLevel(tenantId, 5)
  const toWarehouseId = `wh-${randomUUID()}`

  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      transferStock(tenantId, { skuId, fromWarehouseId: warehouseId, toWarehouseId, quantity: 1 }, 'test'),
    ),
  )
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5)

  const src = await inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId, warehouseId } })
  assert.equal(src.quantityOnHand, 0)
  assert.equal(src.quantityAvailable, 0)
  const dst = await inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId, warehouseId: toWarehouseId } })
  assert.equal(dst.quantityOnHand, 5)
})

test('adjustStock refuses to drop on-hand below reserved and applies relative deltas', async () => {
  const tenantId = `t-${randomUUID()}`
  const { skuId, warehouseId } = await seedLevel(tenantId, 10, 6)

  await assert.rejects(
    () => adjustStock(tenantId, { skuId, warehouseId, quantityDelta: -5 }, 'test'),
    (e: unknown) => e instanceof ApiError && e.status === 400,
  )
  await adjustStock(tenantId, { skuId, warehouseId, quantityDelta: -4 }, 'test')
  await adjustStock(tenantId, { skuId, warehouseId, quantityDelta: 3 }, 'test')

  const level = await inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId, warehouseId } })
  assert.equal(level.quantityOnHand, 9)
  assert.equal(level.quantityReserved, 6)
  assert.equal(level.quantityAvailable, 3)
})
