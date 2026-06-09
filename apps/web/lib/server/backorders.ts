import { randomUUID } from 'node:crypto'
import { orderDb } from './db'
import * as inv from './inventory'
import * as lots from './inventory-lots'
import { ApiError } from './session'

export type PartialReserveResult = {
  allocated: number
  backordered: number
  reservationIds: string[]
  batchId?: string
}

export async function reserveLineWithBackorder(
  tenantId: string,
  dto: {
    orderId: string
    orderLineItemId: string
    skuId: string
    warehouseId: string
    quantity: number
    correlationId: string
    preferredBatchId?: string | null
  },
): Promise<PartialReserveResult> {
  let remaining = dto.quantity
  const reservationIds: string[] = []
  let allocated = 0
  let primaryBatch: string | undefined

  const allocations = dto.preferredBatchId
    ? [{ batchId: dto.preferredBatchId, quantity: dto.quantity }]
    : await lots.allocateBatchesFefo(tenantId, dto.skuId, dto.warehouseId, dto.quantity)

  if (allocations.length === 0) {
    allocations.push({ batchId: '', quantity: dto.quantity, expiryDate: null })
  }

  for (const alloc of allocations) {
    if (remaining <= 0) break
    const level = await inv.findStockLevel(tenantId, dto.skuId, dto.warehouseId, alloc.batchId || '')
    const available = level?.quantityAvailable ?? 0
    const take = Math.min(remaining, available, alloc.quantity)
    if (take <= 0) continue
    try {
      const resId = await inv.reserveStock(tenantId, {
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        quantity: take,
        orderId: dto.orderId,
        correlationId: dto.correlationId,
        batchId: alloc.batchId || undefined,
      })
      reservationIds.push(resId)
      allocated += take
      remaining -= take
      if (!primaryBatch && alloc.batchId) primaryBatch = alloc.batchId
    } catch {
      // try next batch
    }
  }

  if (remaining > 0) {
    const nonBatchLevel = await inv.findStockLevel(tenantId, dto.skuId, dto.warehouseId, '')
    const take = Math.min(remaining, nonBatchLevel?.quantityAvailable ?? 0)
    if (take > 0) {
      const resId = await inv.reserveStock(tenantId, {
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        quantity: take,
        orderId: dto.orderId,
        correlationId: dto.correlationId,
      })
      reservationIds.push(resId)
      allocated += take
      remaining -= take
    }
  }

  const backordered = remaining

  await orderDb.orderLineItem.update({
    where: { id: dto.orderLineItemId },
    data: {
      quantityAllocated: allocated,
      quantityBackordered: backordered,
      ...(primaryBatch ? { preferredBatchId: primaryBatch } : {}),
    },
  })

  if (backordered > 0) {
    await orderDb.backorderLine.upsert({
      where: { orderLineItemId: dto.orderLineItemId },
      create: {
        id: randomUUID(),
        tenantId,
        orderId: dto.orderId,
        orderLineItemId: dto.orderLineItemId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        quantity: backordered,
        status: allocated > 0 ? 'PARTIAL' : 'OPEN',
      },
      update: {
        quantity: backordered,
        status: allocated > 0 ? 'PARTIAL' : 'OPEN',
      },
    })
  }

  return { allocated, backordered, reservationIds, batchId: primaryBatch }
}

export async function listOpenBackorders(tenantId: string, limit = 50) {
  return orderDb.backorderLine.findMany({
    where: { tenantId, status: { in: ['OPEN', 'PARTIAL'] } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
}

export async function fillBackordersOnReceipt(tenantId: string, skuId: string, warehouseId: string) {
  const open = await orderDb.backorderLine.findMany({
    where: { tenantId, skuId, warehouseId, status: { in: ['OPEN', 'PARTIAL'] } },
    orderBy: { createdAt: 'asc' },
    take: 20,
  })

  const filled: string[] = []
  for (const row of open) {
    const need = row.quantity - row.quantityFilled
    if (need <= 0) continue

    const result = await reserveLineWithBackorder(tenantId, {
      orderId: row.orderId,
      orderLineItemId: row.orderLineItemId,
      skuId: row.skuId,
      warehouseId: row.warehouseId,
      quantity: need,
      correlationId: randomUUID(),
    })

    if (result.allocated <= 0) break

    const newFilled = row.quantityFilled + result.allocated
    const status = newFilled >= row.quantity ? 'FILLED' : 'PARTIAL'
    await orderDb.backorderLine.update({
      where: { id: row.id },
      data: { quantityFilled: newFilled, status },
    })

    const line = await orderDb.orderLineItem.findUnique({ where: { id: row.orderLineItemId } })
    if (line) {
      await orderDb.orderLineItem.update({
        where: { id: row.orderLineItemId },
        data: {
          quantityAllocated: line.quantityAllocated + result.allocated,
          quantityBackordered: Math.max(0, line.quantityBackordered - result.allocated),
        },
      })
    }

    filled.push(row.id)

    const order = await orderDb.order.findFirst({
      where: { id: row.orderId, tenantId },
      include: { lineItems: true },
    })
    if (order?.status === 'BACKORDERED') {
      const stillBackordered = order.lineItems.some((li) => li.quantityBackordered > 0)
      if (!stillBackordered) {
        await orderDb.order.update({ where: { id: row.orderId }, data: { status: 'PROCESSING' } })
      }
    }
  }

  return { filledCount: filled.length, filledIds: filled }
}
