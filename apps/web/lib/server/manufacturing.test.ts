import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-inventory'
import { inventoryDb } from './db'
import {
  createBom,
  getBomById,
  listBoms,
  createAssemblyOrder,
  getAssemblyOrder,
  releaseAssemblyOrder,
  completeAssemblyOrder,
  disassembleKit,
} from './manufacturing'

test('Manufacturing & Kitting: BOM, Assembly Work Order, and Dekitting', async (t) => {
  const tenantId = `tenant-${randomUUID()}`
  const userId = `user-${randomUUID()}`

  // 1. Setup Warehouse and SKUs
  const warehouse = await inventoryDb.warehouse.create({
    data: {
      id: randomUUID(),
      tenantId,
      code: `WH-MFG-${Math.floor(1000 + Math.random() * 9000)}`,
      name: 'Assembly & Light Manufacturing Hub',
      address: { city: 'Austin', state: 'TX', zip: '78701' },
      isDefault: true,
    },
  })

  // Component A: Solar Battery Cell ($15.00 each)
  const compSkuA = await inventoryDb.sKU.create({
    data: {
      id: randomUUID(),
      tenantId,
      code: `PART-CELL-${Math.floor(1000 + Math.random() * 9000)}`,
      name: 'Lithium Battery Cell 3.7V',
      category: 'Electronics',
      cost: new Prisma.Decimal('15.00'),
      price: new Prisma.Decimal('25.00'),
      unitOfMeasure: 'EACH',
      imageUrls: [],
      attributes: {},
    },
  })

  // Component B: Solar Enclosure Box ($20.00 each)
  const compSkuB = await inventoryDb.sKU.create({
    data: {
      id: randomUUID(),
      tenantId,
      code: `PART-ENCL-${Math.floor(1000 + Math.random() * 9000)}`,
      name: 'Waterproof Inverter Enclosure',
      category: 'Hardware',
      cost: new Prisma.Decimal('20.00'),
      price: new Prisma.Decimal('35.00'),
      unitOfMeasure: 'EACH',
      imageUrls: [],
      attributes: {},
    },
  })

  // Finished Good: Portable Solar Generator Kit ($120.00 price)
  const finishedSku = await inventoryDb.sKU.create({
    data: {
      id: randomUUID(),
      tenantId,
      code: `KIT-SOLAR-${Math.floor(1000 + Math.random() * 9000)}`,
      name: 'Portable Solar Power Station Kit',
      category: 'Finished Goods',
      cost: new Prisma.Decimal('0.00'),
      price: new Prisma.Decimal('120.00'),
      unitOfMeasure: 'EACH',
      imageUrls: [],
      attributes: {},
    },
  })

  await t.test('BOM creation and circular dependency guard', async () => {
    // Attempting to include the finished good as its own component must fail
    await assert.rejects(
      async () => {
        await createBom(
          tenantId,
          {
            skuId: finishedSku.id,
            name: 'Solar Kit Circular Test',
            items: [{ componentSkuId: finishedSku.id, quantity: 1 }],
          },
          userId,
        )
      },
      { message: /cannot be used as a component of itself/ },
    )

    // Create valid BOM: 2 Battery Cells + 1 Enclosure Box, $5 labor, $2 overhead
    const bom = await createBom(
      tenantId,
      {
        skuId: finishedSku.id,
        name: 'Solar Power Station v1 Recipe',
        description: 'Standard assembly for 500W portable solar generator',
        version: '1.0',
        laborCost: 5.0,
        overheadCost: 2.0,
        items: [
          { componentSkuId: compSkuA.id, quantity: 2, scrapFactorPercent: 0 },
          { componentSkuId: compSkuB.id, quantity: 1, scrapFactorPercent: 0 },
        ],
      },
      userId,
    )

    assert.ok(bom.id)
    assert.equal(bom.skuId, finishedSku.id)
    assert.match(bom.bomNumber, /^BOM-/)
    assert.equal(bom.items.length, 2)

    // Check finished good SKU isKit flag was updated
    const updatedSku = await inventoryDb.sKU.findUnique({ where: { id: finishedSku.id } })
    assert.equal(updatedSku?.isKit, true)

    // Check BOM cost roll-up: (2 * 15.00) + (1 * 20.00) + 5.00 labor + 2.00 overhead = $57.00
    const loadedBom = await getBomById(tenantId, bom.id)
    assert.equal(loadedBom.estimatedUnitCost, 57.0)
    assert.equal(loadedBom.items.length, 2)
  })

  await t.test('Assembly work order shortage detection & completion', async () => {
    const boms = await listBoms(tenantId, { skuId: finishedSku.id })
    assert.equal(boms.length, 1)
    const bom = boms[0]

    // Create assembly order for planned quantity of 10 kits
    const order = await createAssemblyOrder(
      tenantId,
      {
        bomId: bom.id,
        warehouseId: warehouse.id,
        quantityPlanned: 10,
        notes: 'Initial production run of solar power kits',
      },
      userId,
    )

    assert.equal(order.status, 'DRAFT')
    assert.equal(order.quantityPlanned, 10)
    assert.equal(order.quantityCompleted, 0)
    assert.match(order.orderNumber, /^ASM-/)

    // Shortage check before stocking components: canAssemble must be false
    const orderDetail = await getAssemblyOrder(tenantId, order.id)
    assert.equal(orderDetail.canAssemble, false)
    assert.equal(orderDetail.items.length, 2)

    // Item 1 (Cell): 10 kits * 2 = 20 required, 0 available -> shortage 20
    const cellItem = orderDetail.items.find((i) => i.componentSkuId === compSkuA.id)
    assert.equal(cellItem?.quantityRequired, 20)
    assert.equal(cellItem?.shortage, 20)

    // Attempting to complete the order with zero stock must reject
    await assert.rejects(
      async () => {
        await completeAssemblyOrder(tenantId, order.id, {}, userId)
      },
      { message: /Insufficient component inventory/ },
    )

    // Seed stock for components in warehouse:
    // Supply 30 battery cells and 15 enclosures (more than the required 20 and 10)
    await inventoryDb.stockLevel.create({
      data: {
        id: randomUUID(),
        tenantId,
        skuId: compSkuA.id,
        warehouseId: warehouse.id,
        batchId: '',
        quantityOnHand: 30,
        quantityAvailable: 30,
      },
    })
    await inventoryDb.stockLevel.create({
      data: {
        id: randomUUID(),
        tenantId,
        skuId: compSkuB.id,
        warehouseId: warehouse.id,
        batchId: '',
        quantityOnHand: 15,
        quantityAvailable: 15,
      },
    })

    // Release the assembly order
    const released = await releaseAssemblyOrder(tenantId, order.id, userId)
    assert.equal(released.status, 'RELEASED')

    // Now complete the assembly order
    const completedResult = await completeAssemblyOrder(
      tenantId,
      order.id,
      { notes: 'Quality inspection passed. Assembly complete.' },
      userId,
    )

    assert.equal(completedResult.order.status, 'COMPLETED')
    assert.equal(completedResult.order.quantityCompleted, 10)
    assert.equal(completedResult.quantityAssembled, 10)
    assert.equal(completedResult.unitCost, 57.0) // Rolled-up unit cost
    assert.equal(completedResult.totalCost, 570.0) // 10 kits * $57.00

    // Verify component stock decrements:
    // Comp A: 30 - 20 = 10
    const compAStock = await inventoryDb.stockLevel.findFirst({
      where: { tenantId, skuId: compSkuA.id, warehouseId: warehouse.id },
    })
    assert.equal(compAStock?.quantityOnHand, 10)
    assert.equal(compAStock?.quantityAvailable, 10)

    // Comp B: 15 - 10 = 5
    const compBStock = await inventoryDb.stockLevel.findFirst({
      where: { tenantId, skuId: compSkuB.id, warehouseId: warehouse.id },
    })
    assert.equal(compBStock?.quantityOnHand, 5)
    assert.equal(compBStock?.quantityAvailable, 5)

    // Verify finished good stock increment: 10 on hand
    const fgStock = await inventoryDb.stockLevel.findFirst({
      where: { tenantId, skuId: finishedSku.id, warehouseId: warehouse.id },
    })
    assert.equal(fgStock?.quantityOnHand, 10)
    assert.equal(fgStock?.quantityAvailable, 10)

    // Verify StockLedgerEntries:
    const consumeEntries = await inventoryDb.stockLedgerEntry.findMany({
      where: { tenantId, referenceId: order.id, eventType: 'KIT_ASSEMBLY_CONSUME' },
    })
    assert.equal(consumeEntries.length, 2)
    for (const e of consumeEntries) {
      assert.ok(e.quantityDelta < 0)
    }

    const produceEntries = await inventoryDb.stockLedgerEntry.findMany({
      where: { tenantId, referenceId: order.id, eventType: 'KIT_ASSEMBLY_PRODUCE' },
    })
    assert.equal(produceEntries.length, 1)
    assert.equal(produceEntries[0].quantityDelta, 10)
    assert.equal(Number(produceEntries[0].unitCost), 57.0)

    // Finished good SKU unit cost should now be updated
    const finalSku = await inventoryDb.sKU.findUnique({ where: { id: finishedSku.id } })
    assert.equal(Number(finalSku?.cost), 57.0)
  })

  await t.test('Disassembly / Dekitting workflow', async () => {
    const boms = await listBoms(tenantId, { skuId: finishedSku.id })
    const bom = boms[0]

    // Disassemble 3 kits back into components
    const dekitResult = await disassembleKit(
      tenantId,
      {
        skuId: finishedSku.id,
        bomId: bom.id,
        warehouseId: warehouse.id,
        quantity: 3,
        notes: 'Disassembled 3 surplus kits to recover battery cells',
      },
      userId,
    )

    assert.equal(dekitResult.success, true)
    assert.equal(dekitResult.quantityDisassembled, 3)

    // Finished good stock: was 10, now 10 - 3 = 7
    const fgStock = await inventoryDb.stockLevel.findFirst({
      where: { tenantId, skuId: finishedSku.id, warehouseId: warehouse.id },
    })
    assert.equal(fgStock?.quantityOnHand, 7)
    assert.equal(fgStock?.quantityAvailable, 7)

    // Comp A stock: was 10, now 10 + (3 * 2) = 16
    const compAStock = await inventoryDb.stockLevel.findFirst({
      where: { tenantId, skuId: compSkuA.id, warehouseId: warehouse.id },
    })
    assert.equal(compAStock?.quantityOnHand, 16)

    // Comp B stock: was 5, now 5 + (3 * 1) = 8
    const compBStock = await inventoryDb.stockLevel.findFirst({
      where: { tenantId, skuId: compSkuB.id, warehouseId: warehouse.id },
    })
    assert.equal(compBStock?.quantityOnHand, 8)

    // Ledger entries for disassembly
    const dekitConsume = await inventoryDb.stockLedgerEntry.findFirst({
      where: { tenantId, eventType: 'KIT_DISASSEMBLY_CONSUME' },
    })
    assert.ok(dekitConsume)
    assert.equal(dekitConsume.quantityDelta, -3)

    const dekitRestore = await inventoryDb.stockLedgerEntry.findMany({
      where: { tenantId, eventType: 'KIT_DISASSEMBLY_RESTORE' },
    })
    assert.equal(dekitRestore.length, 2)
  })
})
