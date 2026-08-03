import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { complianceDb, inventoryDb, orderDb, wmsDb, crmDb } from './db'
import {
  initiateBatchRecall,
  resolveBatchRecall,
  getBatchRecallImpactReport,
  isBatchRecalled,
  checkBatchNotRecalled,
  listBatchRecalls,
} from './compliance-recall'
import { allocateBatchesFefo } from './inventory-lots'
import { confirmPickLine } from './wms-fulfillment'
import { ApiError } from './session'

test('Batch Recall Workflow & Shipping Block', async (t) => {
  const tenantId = `test-tenant-${randomUUID()}`
  const skuId = `sku-${randomUUID()}`
  const warehouseId = `wh-${randomUUID()}`
  const batchNumber = `LOT-RECALL-TEST-001`

  // Seed SKU
  await inventoryDb.sKU.create({
    data: {
      id: skuId,
      tenantId,
      code: 'TEST-SKU-01',
      name: 'Regulated Test Product',
      category: 'Pharma',
      cost: 50.0,
      price: 100.0,
      imageUrls: [],
      attributes: {},
    },
  })

  // Seed Warehouse
  await inventoryDb.warehouse.create({
    data: {
      id: warehouseId,
      tenantId,
      name: 'Main Distribution Center',
      code: `WH-${warehouseId.slice(0, 6)}`,
      address: { street: '123 Logistics Way', city: 'Dallas', state: 'TX' },
    },
  })

  // Seed Inventory Lot & Stock Level
  await inventoryDb.inventoryLot.create({
    data: {
      id: randomUUID(),
      tenantId,
      skuId,
      warehouseId,
      batchCode: batchNumber,
      expiryDate: new Date('2027-12-31'),
    },
  })

  await inventoryDb.stockLevel.create({
    data: {
      id: randomUUID(),
      tenantId,
      skuId,
      warehouseId,
      batchId: batchNumber,
      quantityOnHand: 200,
      quantityReserved: 50,
      quantityAvailable: 150,
      expiryDate: new Date('2027-12-31'),
    },
  })

  // Seed Customer & Shipped Order (History for traceability)
  const customerId = `cust-${randomUUID()}`
  await crmDb.customer.create({
    data: {
      id: customerId,
      tenantId,
      name: 'Apothecary Wholesalers',
      email: 'recalls@apothecary.com',
      phone: '555-0199',
    },
  })

  const shippedOrderId = `ord-shipped-${randomUUID()}`
  await orderDb.order.create({
    data: {
      id: shippedOrderId,
      tenantId,
      customerId,
      channel: 'B2B_PORTAL',
      paymentMethod: 'NET_TERMS',
      status: 'SHIPPED',
      totalAmount: 500,
      shippingAddress: { street: '456 Healthcare Blvd', city: 'Austin', state: 'TX' },
      lineItems: {
        create: [{ skuId, warehouseId, quantity: 5, unitPrice: 100, preferredBatchId: batchNumber }],
      },
    },
  })

  // Seed Open Fulfillment Task (Pending/Picking for blocking test)
  const openOrderId = `ord-open-${randomUUID()}`
  const openTask = await wmsDb.fulfillmentTask.create({
    data: {
      id: randomUUID(),
      tenantId,
      orderId: openOrderId,
      priority: 'HIGH',
      correlationId: `corr-${randomUUID()}`,
      warehouseId,
      warehouseCode: 'WH-MAIN',
      status: 'PENDING',
      pickLines: {
        create: [{ skuId, warehouseId, quantity: 10, pickedQty: 0, batchId: batchNumber }],
      },
    },
    include: { pickLines: true },
  })

  // 1. Initial State: Batch is NOT recalled
  const initiallyRecalled = await isBatchRecalled(tenantId, batchNumber, skuId)
  assert.equal(initiallyRecalled, false, 'Batch should initially not be recalled')

  // FEFO allocation should return this batch
  const initialFefo = await allocateBatchesFefo(tenantId, skuId, warehouseId, 10)
  assert.equal(initialFefo.length, 1)
  assert.equal(initialFefo[0]?.batchId, batchNumber)

  // 2. Initiate Batch Recall
  const impactReport = await initiateBatchRecall(tenantId, {
    skuId,
    batchNumber,
    reason: 'Contamination detected during quality audit',
    severity: 'MANDATORY',
    initiatedBy: 'Quality Controller Jane',
    notes: 'Immediate quarantine required.',
  })

  assert.ok(impactReport.recall.recallCode.startsWith('RCL-'))
  assert.equal(impactReport.recall.severity, 'MANDATORY')
  assert.equal(impactReport.recall.status, 'ACTIVE')
  assert.equal(impactReport.summary.totalWarehouseUnits, 200)
  assert.equal(impactReport.summary.blockedOrdersCount, 1)
  assert.equal(impactReport.summary.affectedCustomersCount, 1)
  assert.equal(impactReport.customerTraceability.length, 1)
  assert.equal(impactReport.customerTraceability[0]?.customerEmail, 'recalls@apothecary.com')
  assert.ok(impactReport.summary.totalFinancialExposure > 0)

  // 3. Verify Shipping & Fulfillment Blocks
  const isNowRecalled = await isBatchRecalled(tenantId, batchNumber, skuId)
  assert.equal(isNowRecalled, true, 'Batch should be marked as recalled')

  // FEFO Allocation must now skip recalled batch
  const postRecallFefo = await allocateBatchesFefo(tenantId, skuId, warehouseId, 10)
  assert.equal(postRecallFefo.length, 0, 'Recalled batch must be skipped in FEFO')

  // Attempting pick line confirmation must throw ApiError blocking pick/shipping
  await assert.rejects(
    async () => {
      await confirmPickLine(tenantId, openTask.id, openTask.pickLines[0]!.id, { pickedQty: 10 })
    },
    (err: unknown) => {
      return err instanceof ApiError && err.status === 400 && err.message.includes('RECALLED')
    },
    'Picking recalled batch line must fail with 400 RECALLED error',
  )

  // checkBatchNotRecalled helper check
  await assert.rejects(
    async () => {
      await checkBatchNotRecalled(tenantId, batchNumber, skuId)
    },
    (err: unknown) => {
      return err instanceof ApiError && err.status === 400 && err.message.includes('RECALLED')
    },
  )

  // 4. List Recalls
  const activeRecalls = await listBatchRecalls(tenantId, 'ACTIVE')
  assert.equal(activeRecalls.length, 1)
  assert.equal(activeRecalls[0]?.recallCode, impactReport.recall.recallCode)

  // 5. Get Impact Report
  const queriedReport = await getBatchRecallImpactReport(tenantId, impactReport.recall.id)
  assert.equal(queriedReport.recall.id, impactReport.recall.id)

  // 6. Resolve Batch Recall
  const resolved = await resolveBatchRecall(tenantId, impactReport.recall.id)
  assert.equal(resolved.status, 'RESOLVED')

  const isRecalledAfterResolve = await isBatchRecalled(tenantId, batchNumber, skuId)
  assert.equal(isRecalledAfterResolve, false, 'Batch should no longer be recalled after resolution')

  // FEFO allocation should work again after resolution
  const postResolveFefo = await allocateBatchesFefo(tenantId, skuId, warehouseId, 10)
  assert.equal(postResolveFefo.length, 1)
  assert.equal(postResolveFefo[0]?.batchId, batchNumber)
})
