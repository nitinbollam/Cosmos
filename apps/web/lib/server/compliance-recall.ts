import { randomUUID } from 'node:crypto'
import { complianceDb, inventoryDb, orderDb, wmsDb, crmDb } from './db'
import { ApiError } from './session'
import { triggerWebhook } from './webhooks'

export type InitiateRecallInput = {
  skuId: string
  batchNumber: string
  reason: string
  severity?: 'MANDATORY' | 'VOLUNTARY' | 'CAUTION'
  initiatedBy?: string
  notes?: string
}

export type RecallImpactReport = {
  recall: {
    id: string
    tenantId: string
    recallCode: string
    skuId: string
    skuCode: string
    skuName: string
    batchNumber: string
    reason: string
    severity: string
    status: string
    initiatedBy: string | null
    notes: string | null
    recalledAt: Date
    resolvedAt: Date | null
  }
  summary: {
    totalWarehouseUnits: number
    totalShippedUnits: number
    totalRecalledUnits: number
    blockedOrdersCount: number
    affectedCustomersCount: number
    warehouseStockValue: number
    shippedStockValue: number
    totalFinancialExposure: number
  }
  inventoryExposure: Array<{
    warehouseId: string
    warehouseName: string
    warehouseCode: string
    quantityOnHand: number
    quantityReserved: number
    quantityAvailable: number
    expiryDate: Date | null
  }>
  blockedOrders: Array<{
    orderId: string
    orderNumber: string
    customerId: string
    customerName: string
    orderDate: Date
    orderStatus: string
    reservedQuantity: number
    fulfillmentStatus: string
  }>
  customerTraceability: Array<{
    orderId: string
    orderNumber: string
    customerId: string
    customerName: string
    customerEmail: string | null
    customerPhone: string | null
    shippingAddressStr: string
    shippedQuantity: number
    shippedAt: Date | null
    carrier: string | null
    trackingNumber: string | null
    deliveryStatus: string
  }>
}

export async function isBatchRecalled(
  tenantId: string,
  batchNumber?: string | null,
  skuId?: string | null,
): Promise<boolean> {
  if (!batchNumber || !batchNumber.trim()) return false
  const cleanBatch = batchNumber.trim()

  const activeRecall = await complianceDb.batchRecall.findFirst({
    where: {
      tenantId,
      batchNumber: cleanBatch,
      status: 'ACTIVE',
      ...(skuId ? { skuId } : {}),
    },
  })
  if (activeRecall) return true

  const complianceBatch = await complianceDb.batch.findFirst({
    where: {
      tenantId,
      batchNumber: cleanBatch,
      recalled: true,
      ...(skuId ? { skuId } : {}),
    },
  })
  return Boolean(complianceBatch)
}

export async function checkBatchNotRecalled(
  tenantId: string,
  batchNumber?: string | null,
  skuId?: string | null,
): Promise<void> {
  if (!batchNumber || !batchNumber.trim()) return
  const recalled = await isBatchRecalled(tenantId, batchNumber, skuId)
  if (recalled) {
    throw new ApiError(
      400,
      `Batch '${batchNumber}' is RECALLED and blocked from reservation, picking, packing, or shipping.`,
    )
  }
}

export async function listTenantBatches(tenantId: string) {
  const lots = await inventoryDb.inventoryLot.findMany({
    where: { tenantId },
    include: { sku: true },
    orderBy: { receivedAt: 'desc' },
  })

  const recalls = await complianceDb.batchRecall.findMany({
    where: { tenantId, status: 'ACTIVE' },
  })
  const activeRecalledSet = new Set(recalls.map((r) => `${r.skuId}:${r.batchNumber}`))

  const stockLevels = await inventoryDb.stockLevel.findMany({
    where: { tenantId, NOT: { batchId: '' } },
  })

  const batchMap = new Map<
    string,
    {
      skuId: string
      skuCode: string
      skuName: string
      batchNumber: string
      warehouseId: string
      expiryDate: Date | null
      receivedAt: Date
      totalOnHand: number
      isRecalled: boolean
    }
  >()

  for (const lot of lots) {
    const key = `${lot.skuId}:${lot.batchCode}`
    const levels = stockLevels.filter((s) => s.skuId === lot.skuId && s.batchId === lot.batchCode)
    const totalOnHand = levels.reduce((acc, curr) => acc + curr.quantityOnHand, 0)

    if (!batchMap.has(key)) {
      batchMap.set(key, {
        skuId: lot.skuId,
        skuCode: lot.sku.code,
        skuName: lot.sku.name,
        batchNumber: lot.batchCode,
        warehouseId: lot.warehouseId,
        expiryDate: lot.expiryDate,
        receivedAt: lot.receivedAt,
        totalOnHand,
        isRecalled: activeRecalledSet.has(key),
      })
    }
  }

  return Array.from(batchMap.values())
}

export async function initiateBatchRecall(
  tenantId: string,
  input: InitiateRecallInput,
): Promise<RecallImpactReport> {
  const skuId = input.skuId.trim()
  const batchNumber = input.batchNumber.trim()
  const reason = input.reason.trim()

  if (!skuId || !batchNumber || !reason) {
    throw new ApiError(400, 'skuId, batchNumber, and reason are required')
  }

  const existing = await complianceDb.batchRecall.findFirst({
    where: { tenantId, skuId, batchNumber, status: 'ACTIVE' },
  })
  if (existing) {
    throw new ApiError(409, `An active recall already exists for batch '${batchNumber}' (Recall Code: ${existing.recallCode})`)
  }

  const sku = await inventoryDb.sKU.findFirst({ where: { id: skuId, tenantId } })
  if (!sku) throw new ApiError(404, 'SKU not found')

  const count = await complianceDb.batchRecall.count({ where: { tenantId } })
  const recallCode = `RCL-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`

  const recall = await complianceDb.batchRecall.create({
    data: {
      id: randomUUID(),
      tenantId,
      recallCode,
      skuId,
      batchNumber,
      reason,
      severity: input.severity ?? 'MANDATORY',
      status: 'ACTIVE',
      initiatedBy: input.initiatedBy ?? null,
      notes: input.notes ?? null,
      recalledAt: new Date(),
    },
  })

  // Update compliance db batch record if present or create one
  const batches = await complianceDb.batch.findMany({
    where: { tenantId, skuId, batchNumber },
  })
  if (batches.length > 0) {
    await complianceDb.batch.updateMany({
      where: { tenantId, skuId, batchNumber },
      data: { recalled: true, recalledAt: new Date() },
    })
  } else {
    await complianceDb.batch.create({
      data: {
        id: randomUUID(),
        tenantId,
        skuId,
        batchNumber,
        warehouseId: 'DEFAULT',
        quantity: 0,
        expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
        recalled: true,
        recalledAt: new Date(),
      },
    })
  }

  // Trigger compliance.batch_recalled webhook
  void triggerWebhook(tenantId, 'compliance.batch_recalled', {
    recallId: recall.id,
    recallCode: recall.recallCode,
    skuId: recall.skuId,
    skuCode: sku.code,
    batchNumber: recall.batchNumber,
    reason: recall.reason,
    severity: recall.severity,
    recalledAt: recall.recalledAt.toISOString(),
  }).catch(() => undefined)

  return getBatchRecallImpactReport(tenantId, recall.id)
}

export async function resolveBatchRecall(tenantId: string, recallId: string) {
  const recall = await complianceDb.batchRecall.findFirst({
    where: { id: recallId, tenantId },
  })
  if (!recall) throw new ApiError(404, 'Recall not found')
  if (recall.status === 'RESOLVED') return recall

  const updated = await complianceDb.batchRecall.update({
    where: { id: recallId },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
    },
  })

  // Mark compliance batch as recalled = false
  await complianceDb.batch.updateMany({
    where: { tenantId, skuId: recall.skuId, batchNumber: recall.batchNumber },
    data: { recalled: false, recalledAt: null },
  })

  return updated
}

export async function listBatchRecalls(tenantId: string, status?: string) {
  const whereStatus = status?.trim().toUpperCase()
  const rows = await complianceDb.batchRecall.findMany({
    where: {
      tenantId,
      ...(whereStatus === 'ACTIVE' || whereStatus === 'RESOLVED' ? { status: whereStatus } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })

  const skuIds = [...new Set(rows.map((r) => r.skuId))]
  const skus = await inventoryDb.sKU.findMany({
    where: { tenantId, id: { in: skuIds } },
  })
  const skuMap = new Map(skus.map((s) => [s.id, s]))

  return rows.map((r) => ({
    ...r,
    skuCode: skuMap.get(r.skuId)?.code ?? 'UNKNOWN',
    skuName: skuMap.get(r.skuId)?.name ?? 'Unknown Product',
  }))
}

export async function getBatchRecallImpactReport(
  tenantId: string,
  recallId: string,
): Promise<RecallImpactReport> {
  const recall = await complianceDb.batchRecall.findFirst({
    where: { id: recallId, tenantId },
  })
  if (!recall) throw new ApiError(404, 'Recall record not found')

  const sku = await inventoryDb.sKU.findFirst({
    where: { id: recall.skuId, tenantId },
  })
  const skuCode = sku?.code ?? 'UNKNOWN'
  const skuName = sku?.name ?? 'Unknown SKU'
  const unitCost = Number(sku?.cost ?? 0)
  const unitPrice = Number(sku?.price ?? 0)

  // 1. Warehouse Inventory Exposure
  const stockLevels = await inventoryDb.stockLevel.findMany({
    where: { tenantId, skuId: recall.skuId, batchId: recall.batchNumber },
  })
  const warehouses = await inventoryDb.warehouse.findMany({
    where: { tenantId },
  })
  const warehouseMap = new Map(warehouses.map((w) => [w.id, w]))

  const inventoryExposure = stockLevels.map((sl) => {
    const wh = warehouseMap.get(sl.warehouseId)
    return {
      warehouseId: sl.warehouseId,
      warehouseName: wh?.name ?? `Warehouse ${sl.warehouseId}`,
      warehouseCode: wh?.code ?? sl.warehouseId,
      quantityOnHand: sl.quantityOnHand,
      quantityReserved: sl.quantityReserved,
      quantityAvailable: sl.quantityAvailable,
      expiryDate: sl.expiryDate,
    }
  })

  const totalWarehouseUnits = inventoryExposure.reduce((acc, curr) => acc + curr.quantityOnHand, 0)

  // 2. Open / Blocked Orders containing this batch
  const openFulfillmentTasks = await wmsDb.fulfillmentTask.findMany({
    where: {
      tenantId,
      status: { in: ['PENDING', 'PICKING', 'PACKED'] },
      pickLines: { some: { skuId: recall.skuId, batchId: recall.batchNumber } },
    },
    include: { pickLines: true },
  })

  const blockedOrderIds = [...new Set(openFulfillmentTasks.map((t) => t.orderId))]
  const blockedOrdersRaw = await orderDb.order.findMany({
    where: { tenantId, id: { in: blockedOrderIds } },
    include: { lineItems: true },
  })

  const customerIds = [...new Set(blockedOrdersRaw.map((o) => o.customerId))]
  const customers = await crmDb.customer.findMany({
    where: { tenantId, id: { in: customerIds } },
  })
  const customerMap = new Map(customers.map((c) => [c.id, c]))

  const blockedOrders = openFulfillmentTasks.map((task) => {
    const order = blockedOrdersRaw.find((o) => o.id === task.orderId)
    const cust = order ? customerMap.get(order.customerId) : null
    const line = task.pickLines.find((p) => p.skuId === recall.skuId && p.batchId === recall.batchNumber)

    return {
      orderId: task.orderId,
      orderNumber: order ? `ORD-${order.id.slice(-6).toUpperCase()}` : task.orderId.slice(0, 8),
      customerId: order?.customerId ?? 'UNKNOWN',
      customerName: cust?.name ?? order?.customerId ?? 'Unknown Customer',
      orderDate: order?.createdAt ?? task.createdAt,
      orderStatus: order?.status ?? 'PROCESSING',
      reservedQuantity: line?.quantity ?? 0,
      fulfillmentStatus: task.status,
    }
  })

  // 3. Shipped Orders & Customer Traceability
  const dispatchedTasks = await wmsDb.fulfillmentTask.findMany({
    where: {
      tenantId,
      status: 'DISPATCHED',
      pickLines: { some: { skuId: recall.skuId, batchId: recall.batchNumber } },
    },
    include: { pickLines: true },
  })
  const dispatchedOrderIds = [...new Set(dispatchedTasks.map((t) => t.orderId))]

  const shippedOrdersRaw = await orderDb.order.findMany({
    where: {
      tenantId,
      OR: [
        { id: { in: dispatchedOrderIds } },
        { status: 'SHIPPED', lineItems: { some: { skuId: recall.skuId, preferredBatchId: recall.batchNumber } } },
      ],
    },
    include: { lineItems: true },
  })

  const shippedCustomerIds = [...new Set(shippedOrdersRaw.map((o) => o.customerId))]
  const shippedCustomers = await crmDb.customer.findMany({
    where: { tenantId, id: { in: shippedCustomerIds } },
  })
  const shippedCustomerMap = new Map(shippedCustomers.map((c) => [c.id, c]))

  const allOrderShipments = await orderDb.orderShipment.findMany({
    where: { tenantId, orderId: { in: shippedOrdersRaw.map((o) => o.id) } },
  })
  const shipmentMap = new Map(allOrderShipments.map((s) => [s.orderId, s]))

  const customerTraceability = shippedOrdersRaw.map((order) => {
    const cust = shippedCustomerMap.get(order.customerId)
    const task = dispatchedTasks.find((t) => t.orderId === order.id)
    const taskLine = task?.pickLines.find((p) => p.skuId === recall.skuId && p.batchId === recall.batchNumber)
    const orderLine = order.lineItems.find((l) => l.skuId === recall.skuId)
    const shippedQty = taskLine?.pickedQty ?? orderLine?.quantity ?? 0
    const shipment = shipmentMap.get(order.id)

    let addrStr = 'Address on file'
    if (order.shippingAddress && typeof order.shippingAddress === 'object') {
      const a = order.shippingAddress as Record<string, string>
      addrStr = `${a.street ?? a.line1 ?? ''}, ${a.city ?? ''} ${a.state ?? ''}`.trim()
    }

    return {
      orderId: order.id,
      orderNumber: `ORD-${order.id.slice(-6).toUpperCase()}`,
      customerId: order.customerId,
      customerName: cust?.name ?? order.customerId,
      customerEmail: cust?.email ?? null,
      customerPhone: cust?.phone ?? null,
      shippingAddressStr: addrStr || 'Address on file',
      shippedQuantity: shippedQty,
      shippedAt: shipment?.shippedAt ?? order.updatedAt,
      carrier: shipment?.carrier ?? 'Standard Ground',
      trackingNumber: shipment?.trackingNumber ?? null,
      deliveryStatus: order.status === 'SHIPPED' ? 'DELIVERED/IN-TRANSIT' : order.status,
    }
  })

  const totalShippedUnits = customerTraceability.reduce((acc, curr) => acc + curr.shippedQuantity, 0)
  const totalRecalledUnits = totalWarehouseUnits + totalShippedUnits

  const warehouseStockValue = Math.round(totalWarehouseUnits * unitCost * 100) / 100
  const shippedStockValue = Math.round(totalShippedUnits * unitPrice * 100) / 100
  const totalFinancialExposure = Math.round((warehouseStockValue + shippedStockValue) * 100) / 100

  const uniqueAffectedCustomers = new Set(customerTraceability.map((c) => c.customerId))

  return {
    recall: {
      id: recall.id,
      tenantId: recall.tenantId,
      recallCode: recall.recallCode,
      skuId: recall.skuId,
      skuCode,
      skuName,
      batchNumber: recall.batchNumber,
      reason: recall.reason,
      severity: recall.severity,
      status: recall.status,
      initiatedBy: recall.initiatedBy,
      notes: recall.notes,
      recalledAt: recall.recalledAt,
      resolvedAt: recall.resolvedAt,
    },
    summary: {
      totalWarehouseUnits,
      totalShippedUnits,
      totalRecalledUnits,
      blockedOrdersCount: blockedOrders.length,
      affectedCustomersCount: uniqueAffectedCustomers.size,
      warehouseStockValue,
      shippedStockValue,
      totalFinancialExposure,
    },
    inventoryExposure,
    blockedOrders,
    customerTraceability,
  }
}
