import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-inventory'
import { inventoryDb } from './db'
import { ApiError } from './session'

import { swallowed } from './fire-and-forget'
function queueSalesChannelPush(tenantId: string, skuId: string) {
  void import('./sales-channels/core')
    .then(({ queuePriceOrQuantityPush }) => queuePriceOrQuantityPush(tenantId, skuId))
    .catch(swallowed('inventory.queueSalesChannelPush'))
}

export type CreateSkuInput = {
  code: string
  name: string
  description?: string
  category: string
  subcategory?: string
  barcode?: string
  unitOfMeasure?: string
  weightGrams?: number
  isTobacco?: boolean
  isRegulated?: boolean
  ageRestricted?: boolean
  minimumAge?: number | null
  manufacturerId?: string
  manufacturerDid?: string
  exciseTaxCategory?: string
  cost: number
  price: number
  minPrice?: number
  defaultWarehouseId?: string
  defaultLocationId?: string
  reorderPoint?: number
  reorderQty?: number
  trackLot?: boolean
  trackSerial?: boolean
}

export async function distinctCategories(tenantId: string) {
  const rows = await inventoryDb.sKU.groupBy({
    by: ['category'],
    where: { tenantId, isActive: true },
  })
  return rows.map((r) => r.category).sort((a, b) => a.localeCompare(b))
}

export async function listSkus(
  tenantId: string,
  page = 1,
  pageSize = 50,
  search?: string,
  opts?: { category?: string; warehouseId?: string; inStockOnly?: boolean; customerId?: string },
) {
  const where: Prisma.SKUWhereInput = {
    tenantId,
    ...(search
      ? {
          OR: [
            { code: { contains: search } },
            { name: { contains: search } },
          ],
        }
      : {}),
    ...(opts?.category ? { category: { equals: opts.category } } : {}),
  }

  if (opts?.inStockOnly) {
    const rows = await inventoryDb.stockLevel.findMany({
      where: {
        tenantId,
        quantityAvailable: { gt: 0 },
        ...(opts.warehouseId ? { warehouseId: opts.warehouseId } : {}),
      },
      distinct: ['skuId'],
      select: { skuId: true },
    })
    const idList = [...new Set(rows.map((r) => r.skuId))]
    if (idList.length === 0) return { items: [], total: 0, page, pageSize, hasMore: false }
    where.id = { in: idList }
  }

  const [items, total] = await Promise.all([
    inventoryDb.sKU.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: 'asc' },
    }),
    inventoryDb.sKU.count({ where }),
  ])

  const skuIds = items.map((i) => i.id)
  if (skuIds.length === 0) return { items: [], total, page, pageSize, hasMore: page * pageSize < total }

  const levels = await inventoryDb.stockLevel.findMany({
    where: {
      tenantId,
      skuId: { in: skuIds },
      ...(opts?.warehouseId ? { warehouseId: opts.warehouseId } : {}),
    },
  })

  const agg = new Map<string, { onHand: number; reserved: number; available: number; reorderPoint: number; reorderQty: number }>()
  for (const l of levels) {
    const cur = agg.get(l.skuId) ?? { onHand: 0, reserved: 0, available: 0, reorderPoint: 0, reorderQty: 0 }
    cur.onHand += l.quantityOnHand
    cur.reserved += l.quantityReserved
    cur.available += l.quantityAvailable
    cur.reorderPoint = Math.max(cur.reorderPoint, l.reorderPoint)
    cur.reorderQty = Math.max(cur.reorderQty, l.reorderQty)
    agg.set(l.skuId, cur)
  }

  const enriched = items.map((sku) => {
    const s = agg.get(sku.id)
    return {
      ...sku,
      quantityOnHand: s?.onHand ?? 0,
      quantityReserved: s?.reserved ?? 0,
      quantityAvailable: s?.available ?? 0,
      reorderPoint: s?.reorderPoint ?? 0,
      reorderQty: s?.reorderQty ?? 0,
    }
  })

  if (opts?.customerId) {
    const { enrichSkusWithCustomerPrices } = await import('./pricing')
    const priced = await enrichSkusWithCustomerPrices(tenantId, opts.customerId, enriched)
    return { items: priced, total, page, pageSize, hasMore: page * pageSize < total }
  }

  return { items: enriched, total, page, pageSize, hasMore: page * pageSize < total }
}

export async function findSkuById(tenantId: string, idOrCode: string) {
  const trimmed = idOrCode.trim()
  const sku = await inventoryDb.sKU.findFirst({
    where: {
      tenantId,
      OR: [{ id: trimmed }, { code: trimmed }],
    },
  })
  if (!sku) throw new ApiError(404, 'SKU not found')
  return sku
}

export async function getSkuReorderSuggestion(tenantId: string, skuId: string, warehouseId?: string) {
  const { getSkuDemandPlan } = await import('./demand-planning')
  const plan = await getSkuDemandPlan(tenantId, skuId, warehouseId)
  const sku = await findSkuById(tenantId, skuId)
  const suggestedQty =
    plan.method === 'USAGE_FORECAST' && plan.suggestedOrderQty > 0
      ? plan.suggestedOrderQty
      : plan.staticReorderQty
  return {
    sku: { id: sku.id, code: sku.code, name: sku.name, cost: Number(sku.cost ?? 0) },
    warehouseId: plan.warehouseId,
    quantityAvailable: plan.quantityAvailable,
    reorderPoint: plan.reorderPoint,
    suggestedQty,
    demandMethod: plan.method,
    avgDailyUsage: plan.avgDailyUsage,
  }
}

export async function findSkuByCode(tenantId: string, code: string) {
  const sku = await inventoryDb.sKU.findFirst({
    where: { tenantId, code: { equals: code.trim() } },
  })
  if (!sku) throw new ApiError(404, `SKU code not found: ${code}`)
  return sku
}

/** Generate normalized GTIN permutations (UPC-A, EAN-13, GTIN-14, stripped) for barcode lookup. */
export function getGtinLookupCandidates(raw: string): string[] {
  const v = raw.trim()
  if (!v) return []
  const set = new Set<string>([v])
  if (/^\d+$/.test(v) && v.length <= 14) {
    const unpadded = v.replace(/^0+/, '')
    if (unpadded) {
      set.add(unpadded)
      set.add(unpadded.padStart(8, '0'))
      set.add(unpadded.padStart(12, '0'))
      set.add(unpadded.padStart(13, '0'))
      set.add(unpadded.padStart(14, '0'))
    }
  }
  return Array.from(set)
}

/** Code or barcode — receiving / warehouse scans with GTIN normalization. */
export async function findSkuByScanValue(tenantId: string, raw: string) {
  const v = raw.trim()
  if (!v) throw new ApiError(400, 'scan value required')

  const candidates = getGtinLookupCandidates(v)

  const byCode = await inventoryDb.sKU.findFirst({
    where: { tenantId, code: { in: candidates }, isActive: true },
  })
  if (byCode) return byCode

  const byBar = await inventoryDb.sKU.findFirst({
    where: { tenantId, barcode: { in: candidates }, isActive: true },
  })
  if (byBar) return byBar

  throw new ApiError(404, `No SKU for scan value: ${v}`)
}

export type ReceiveStockInput = {
  skuId: string
  warehouseId: string
  quantity: number
  unitCost: number
  supplierId?: string
  poId?: string
  batchId?: string
  locationId?: string
}

export async function receiveStock(tenantId: string, dto: ReceiveStockInput, performedBy: string) {
  const sku = await findSkuById(tenantId, dto.skuId)
  await findWarehouseById(tenantId, dto.warehouseId)
  const correlationId = randomUUID()
  const entryId = randomUUID()
  const batchKey = dto.batchId ?? ''

  if (batchKey && sku.trackLot) {
    const { ensureInventoryLot } = await import('./inventory-lots')
    await ensureInventoryLot(tenantId, {
      skuId: dto.skuId,
      warehouseId: dto.warehouseId,
      batchCode: batchKey,
      supplierId: dto.supplierId ?? null,
    })
  }

  const result = await inventoryDb.$transaction(async (tx) => {
    const currentLevel = await tx.stockLevel.upsert({
      where: {
        tenantId_skuId_warehouseId_batchId: {
          tenantId,
          skuId: dto.skuId,
          warehouseId: dto.warehouseId,
          batchId: batchKey,
        },
      },
      update: {
        quantityOnHand: { increment: dto.quantity },
        quantityAvailable: { increment: dto.quantity },
      },
      create: {
        id: randomUUID(),
        tenantId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        locationId: dto.locationId ?? null,
        batchId: batchKey,
        quantityOnHand: dto.quantity,
        quantityReserved: 0,
        quantityAvailable: dto.quantity,
      },
    })

    return tx.stockLedgerEntry.create({
      data: {
        id: entryId,
        tenantId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        locationId: dto.locationId ?? null,
        batchId: batchKey,
        eventType: 'STOCK_RECEIVED',
        quantityDelta: dto.quantity,
        quantityAfter: currentLevel.quantityOnHand,
        unitCost: new Prisma.Decimal(dto.unitCost),
        referenceId: dto.poId,
        referenceType: dto.poId ? 'PURCHASE_ORDER' : undefined,
        performedBy,
        correlationId,
      },
    })
  })

  // The receipt is committed. Filling backorders from it is retried if it fails, never dropped.
  const { attemptOrQueue } = await import('./deferred-work')
  await attemptOrQueue(
    {
      tenantId,
      kind: 'BACKORDER_FILL',
      sourceType: 'Sku',
      sourceId: `${dto.skuId}:${dto.warehouseId}`,
      payload: { skuId: dto.skuId, warehouseId: dto.warehouseId },
    },
    async () => {
      const { fillBackordersOnReceipt } = await import('./backorders')
      await fillBackordersOnReceipt(tenantId, dto.skuId, dto.warehouseId)
    },
  )

  queueSalesChannelPush(tenantId, dto.skuId)
  return result
}

export type TransferStockInput = {
  skuId: string
  fromWarehouseId: string
  toWarehouseId: string
  quantity: number
  batchId?: string
}

export async function transferStock(tenantId: string, dto: TransferStockInput, performedBy: string) {
  if (dto.fromWarehouseId === dto.toWarehouseId) {
    throw new ApiError(400, 'Source and destination warehouse must differ')
  }
  const batchKey = dto.batchId ?? ''
  const correlationId = randomUUID()

  await inventoryDb.$transaction(async (tx) => {
    const from = await tx.stockLevel.findFirst({
      where: { tenantId, skuId: dto.skuId, warehouseId: dto.fromWarehouseId, batchId: batchKey },
    })
    if (!from || from.quantityAvailable < dto.quantity) {
      throw new ApiError(400, 'Insufficient available stock at source warehouse')
    }

    // Guarded atomic decrement: a concurrent transfer/reserve/ship cannot be overwritten and
    // available can never go negative (available = onHand - reserved).
    const moved = await tx.stockLevel.updateMany({
      where: { id: from.id, tenantId, quantityAvailable: { gte: dto.quantity } },
      data: {
        quantityOnHand: { decrement: dto.quantity },
        quantityAvailable: { decrement: dto.quantity },
      },
    })
    if (moved.count !== 1) {
      throw new ApiError(400, 'Insufficient available stock at source warehouse')
    }
    const fromAfter = await tx.stockLevel.findUniqueOrThrow({
      where: { id: from.id },
      select: { quantityOnHand: true },
    })
    const fromOnHand = fromAfter.quantityOnHand

    await tx.stockLedgerEntry.create({
      data: {
        id: randomUUID(),
        tenantId,
        skuId: dto.skuId,
        warehouseId: dto.fromWarehouseId,
        batchId: batchKey,
        eventType: 'TRANSFER_OUT',
        quantityDelta: -dto.quantity,
        quantityAfter: fromOnHand,
        unitCost: new Prisma.Decimal(0),
        referenceId: correlationId,
        referenceType: 'TRANSFER',
        performedBy,
        correlationId,
      },
    })

    const toRow = await tx.stockLevel.upsert({
      where: {
        tenantId_skuId_warehouseId_batchId: {
          tenantId,
          skuId: dto.skuId,
          warehouseId: dto.toWarehouseId,
          batchId: batchKey,
        },
      },
      update: {
        quantityOnHand: { increment: dto.quantity },
        quantityAvailable: { increment: dto.quantity },
      },
      create: {
        id: randomUUID(),
        tenantId,
        skuId: dto.skuId,
        warehouseId: dto.toWarehouseId,
        batchId: batchKey,
        quantityOnHand: dto.quantity,
        quantityReserved: 0,
        quantityAvailable: dto.quantity,
      },
    })

    await tx.stockLedgerEntry.create({
      data: {
        id: randomUUID(),
        tenantId,
        skuId: dto.skuId,
        warehouseId: dto.toWarehouseId,
        batchId: batchKey,
        eventType: 'TRANSFER_IN',
        quantityDelta: dto.quantity,
        quantityAfter: toRow.quantityOnHand,
        unitCost: new Prisma.Decimal(0),
        referenceId: correlationId,
        referenceType: 'TRANSFER',
        performedBy,
        correlationId,
      },
    })
  })

  queueSalesChannelPush(tenantId, dto.skuId)
  return { ok: true }
}

export async function createSku(tenantId: string, input: CreateSkuInput) {
  try {
    const sku = await inventoryDb.sKU.create({
      data: {
        tenantId,
        code: input.code,
        name: input.name,
        description: input.description,
        category: input.category,
        subcategory: input.subcategory,
        barcode: input.barcode,
        unitOfMeasure: input.unitOfMeasure ?? 'EACH',
        weightGrams: input.weightGrams !== undefined ? new Prisma.Decimal(input.weightGrams) : undefined,
        isTobacco: input.isTobacco ?? false,
        isRegulated: input.isRegulated ?? false,
        ageRestricted: input.ageRestricted ?? Boolean(input.isTobacco),
        minimumAge:
          input.minimumAge !== undefined && input.minimumAge !== null
            ? Math.round(Number(input.minimumAge))
            : input.isTobacco
              ? 21
              : null,
        manufacturerId: input.manufacturerId,
        manufacturerDid: input.manufacturerDid,
        exciseTaxCategory: input.exciseTaxCategory,
        cost: new Prisma.Decimal(input.cost),
        price: new Prisma.Decimal(input.price),
        minPrice: input.minPrice !== undefined ? new Prisma.Decimal(input.minPrice) : undefined,
        imageUrls: [],
        attributes: {},
      },
    })

    if (input.defaultWarehouseId) {
      await inventoryDb.stockLevel.upsert({
        where: {
          tenantId_skuId_warehouseId_batchId: {
            tenantId,
            skuId: sku.id,
            warehouseId: input.defaultWarehouseId,
            batchId: '',
          },
        },
        create: {
          id: randomUUID(),
          tenantId,
          skuId: sku.id,
          warehouseId: input.defaultWarehouseId,
          locationId: input.defaultLocationId ?? null,
          batchId: '',
          quantityOnHand: 0,
          quantityReserved: 0,
          quantityAvailable: 0,
          reorderPoint: input.reorderPoint ?? 0,
          reorderQty: input.reorderQty ?? 0,
        },
        update: {
          reorderPoint: input.reorderPoint ?? 0,
          reorderQty: input.reorderQty ?? 0,
          ...(input.defaultLocationId !== undefined ? { locationId: input.defaultLocationId || null } : {}),
        },
      })
    }
    return sku
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new ApiError(409, 'SKU code already exists for this tenant')
    throw e
  }
}

export async function updateSku(tenantId: string, id: string, patch: Partial<CreateSkuInput> & { isActive?: boolean }) {
  await findSkuById(tenantId, id)
  try {
    const ageRestricted =
      patch.ageRestricted !== undefined
        ? Boolean(patch.ageRestricted)
        : patch.isTobacco !== undefined
          ? Boolean(patch.isTobacco)
          : undefined
    const updated = await inventoryDb.sKU.update({
      where: { id },
      data: {
        ...(patch.code !== undefined ? { code: patch.code } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.subcategory !== undefined ? { subcategory: patch.subcategory } : {}),
        ...(patch.barcode !== undefined ? { barcode: patch.barcode } : {}),
        ...(patch.unitOfMeasure !== undefined ? { unitOfMeasure: patch.unitOfMeasure } : {}),
        ...(patch.isTobacco !== undefined ? { isTobacco: Boolean(patch.isTobacco) } : {}),
        ...(patch.isRegulated !== undefined ? { isRegulated: Boolean(patch.isRegulated) } : {}),
        ...(ageRestricted !== undefined ? { ageRestricted } : {}),
        ...(patch.minimumAge !== undefined
          ? {
              minimumAge:
                patch.minimumAge === null || patch.minimumAge === ('' as unknown)
                  ? null
                  : Math.round(Number(patch.minimumAge)),
            }
          : patch.isTobacco === true
            ? { minimumAge: 21 }
            : {}),
        ...(patch.manufacturerDid !== undefined ? { manufacturerDid: patch.manufacturerDid } : {}),
        ...(patch.exciseTaxCategory !== undefined ? { exciseTaxCategory: patch.exciseTaxCategory } : {}),
        ...(patch.cost !== undefined ? { cost: new Prisma.Decimal(+patch.cost) } : {}),
        ...(patch.price !== undefined ? { price: new Prisma.Decimal(+patch.price) } : {}),
        ...(patch.minPrice !== undefined
          ? { minPrice: patch.minPrice == null ? null : new Prisma.Decimal(+patch.minPrice) }
          : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        ...(patch.trackLot !== undefined ? { trackLot: Boolean(patch.trackLot) } : {}),
        ...(patch.trackSerial !== undefined ? { trackSerial: Boolean(patch.trackSerial) } : {}),
      },
    })
    if (patch.price !== undefined) queueSalesChannelPush(tenantId, id)
    return updated
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new ApiError(409, 'SKU code already exists for this tenant')
    throw e
  }
}

export async function importSkus(tenantId: string, rows: CreateSkuInput[]) {
  let created = 0
  const errors: Array<{ row: number; message: string }> = []
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const rowNum = index + 2
    if (!row.code?.trim() || !row.name?.trim() || !row.category?.trim()) {
      errors.push({ row: rowNum, message: 'code, name, and category are required' })
      continue
    }
    try {
      await createSku(tenantId, row)
      created++
    } catch (e) {
      errors.push({ row: rowNum, message: e instanceof Error ? e.message : 'Could not create SKU' })
    }
  }
  return { created, failed: errors.length, errors }
}

export async function listWarehouses(tenantId: string, opts?: { includeVehicles?: boolean }) {
  const warehouses = await inventoryDb.warehouse.findMany({
    // Vans are not places an order can ship from or a picker can walk to; they have their own endpoints.
    where: { tenantId, ...(opts?.includeVehicles ? {} : { kind: 'WAREHOUSE' }) },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  })
  const stockSummary = await inventoryDb.stockLevel.groupBy({
    by: ['warehouseId'],
    where: { tenantId, quantityAvailable: { gt: 0 } },
    _sum: { quantityAvailable: true },
    _count: { skuId: true },
  })
  const stockMap = new Map(
    stockSummary.map((s) => [
      s.warehouseId,
      {
        totalAvailable: s._sum.quantityAvailable ?? 0,
        inStockSkuCount: s._count.skuId ?? 0,
      },
    ]),
  )
  return warehouses.map((w) => ({
    ...w,
    totalAvailable: stockMap.get(w.id)?.totalAvailable ?? 0,
    inStockSkuCount: stockMap.get(w.id)?.inStockSkuCount ?? 0,
  }))
}

export async function findWarehouseById(tenantId: string, id: string) {
  const wh = await inventoryDb.warehouse.findFirst({ where: { id, tenantId } })
  if (!wh) throw new ApiError(404, 'Warehouse not found')
  return wh
}

export async function createWarehouse(
  tenantId: string,
  input: {
    name: string
    code: string
    address: { line1: string; city: string; state: string; postalCode: string; country?: string }
    isDefault?: boolean
  },
) {
  try {
    return await inventoryDb.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.warehouse.updateMany({ where: { tenantId }, data: { isDefault: false } })
      }
      return tx.warehouse.create({
        data: {
          tenantId,
          name: input.name,
          code: input.code,
          address: input.address as object,
          isDefault: input.isDefault ?? false,
        },
      })
    })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new ApiError(409, 'Warehouse code already exists')
    throw e
  }
}

export async function setDefaultWarehouse(tenantId: string, id: string) {
  await findWarehouseById(tenantId, id)
  await inventoryDb.$transaction([
    inventoryDb.warehouse.updateMany({ where: { tenantId }, data: { isDefault: false } }),
    inventoryDb.warehouse.update({ where: { id }, data: { isDefault: true } }),
  ])
  return findWarehouseById(tenantId, id)
}

export function ledgerForSku(tenantId: string, skuId: string, limit = 100) {
  return inventoryDb.stockLedgerEntry.findMany({
    where: { tenantId, skuId },
    orderBy: { occurredAt: 'desc' },
    take: Math.min(500, Math.max(1, limit)),
  })
}

export async function adjustStock(
  tenantId: string,
  dto: {
    skuId: string
    warehouseId: string
    quantityDelta: number
    reason?: string
    batchId?: string
    locationId?: string | null
    referenceId?: string
    referenceType?: string
    correlationId?: string
    /** Post the loss (or find) to the general ledger at the SKU's cost. Not for adjustments that carry their own journal. */
    ledger?: boolean
  },
  performedBy: string,
) {
  if (!Number.isFinite(dto.quantityDelta) || dto.quantityDelta === 0) {
    throw new ApiError(400, 'quantityDelta must be a non-zero number')
  }

  const batchKey = dto.batchId ?? ''
  const correlationId = dto.correlationId ?? randomUUID()
  const prevLevel = await inventoryDb.stockLevel.findFirst({
    where: { tenantId, skuId: dto.skuId, warehouseId: dto.warehouseId, batchId: batchKey },
  })
  const result = await inventoryDb.$transaction(async (tx) => {
    const level = await tx.stockLevel.findFirst({
      where: { tenantId, skuId: dto.skuId, warehouseId: dto.warehouseId, batchId: batchKey },
    })
    if (!level) throw new ApiError(404, 'Stock level not found')
    // Relative, guarded update. available = onHand - reserved, so requiring
    // available >= -delta covers both "would go negative" and "less than reserved".
    const guarded = await tx.stockLevel.updateMany({
      where: {
        id: level.id,
        tenantId,
        ...(dto.quantityDelta < 0 ? { quantityAvailable: { gte: -dto.quantityDelta } } : {}),
      },
      data: {
        quantityOnHand: { increment: dto.quantityDelta },
        quantityAvailable: { increment: dto.quantityDelta },
        ...(dto.locationId !== undefined ? { locationId: dto.locationId || null } : {}),
      },
    })
    if (guarded.count !== 1) {
      throw new ApiError(400, 'Adjustment would leave less on hand than reserved quantity')
    }
    const updatedLevel = await tx.stockLevel.findUniqueOrThrow({ where: { id: level.id } })
    const newOnHand = updatedLevel.quantityOnHand
    await tx.stockLedgerEntry.create({
      data: {
        id: randomUUID(),
        tenantId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        locationId: dto.locationId ?? level.locationId,
        batchId: batchKey,
        eventType: 'STOCK_ADJUSTED',
        quantityDelta: dto.quantityDelta,
        quantityAfter: newOnHand,
        unitCost: new Prisma.Decimal(0),
        referenceId: dto.referenceId,
        referenceType: dto.referenceType ?? 'ADJUSTMENT',
        performedBy,
        correlationId,
      },
    })
    return updatedLevel
  })

  if (
    prevLevel &&
    prevLevel.reorderPoint > 0 &&
    prevLevel.quantityAvailable > prevLevel.reorderPoint &&
    result.quantityAvailable <= result.reorderPoint
  ) {
    const sku = await inventoryDb.sKU.findFirst({ where: { id: dto.skuId, tenantId }, select: { code: true } })
    const { notifyLowStock } = await import('./notification-triggers')
    void notifyLowStock(
      tenantId,
      dto.skuId,
      sku?.code ?? dto.skuId,
      result.quantityAvailable,
      result.reorderPoint,
    ).catch(swallowed('inventory.adjustStock'))
    // No dedupe key: a SKU can drop below its reorder point again after a restock.
    const { emitDomainEvent } = await import('./domain-events')
    void emitDomainEvent(tenantId, 'inventory.stock_level_low', {
      skuId: dto.skuId,
      skuCode: sku?.code ?? null,
      warehouseId: dto.warehouseId,
      quantityAvailable: result.quantityAvailable,
      reorderPoint: result.reorderPoint,
    })
  }

  if (dto.ledger) {
    const [{ adjustmentPosting }, { enqueuePostingJobAfterCommit }] = await Promise.all([import('./stock-gl'), import('./posting-outbox')])
    const costRow = await inventoryDb.sKU.findFirst({ where: { id: dto.skuId, tenantId }, select: { cost: true } })
    const posting = adjustmentPosting(costRow?.cost?.toString(), dto.quantityDelta)
    if (posting) {
      await enqueuePostingJobAfterCommit({
        tenantId,
        kind: posting.kind,
        sourceType: 'StockAdjustment',
        sourceId: correlationId,
        variant: `${dto.warehouseId}:${dto.skuId}:${batchKey}`,
        amount: posting.amount,
      })
    }
  }

  queueSalesChannelPush(tenantId, dto.skuId)
  return result
}

export function getStockLevels(tenantId: string, opts: { skuId?: string; warehouseId?: string }) {
  return inventoryDb.stockLevel.findMany({
    where: {
      tenantId,
      ...(opts.skuId ? { skuId: opts.skuId } : {}),
      ...(opts.warehouseId ? { warehouseId: opts.warehouseId } : {}),
    },
  })
}

export async function patchStockLevel(
  tenantId: string,
  levelId: string,
  patch: { reorderPoint?: number; reorderQty?: number; leadTimeDays?: number; locationId?: string | null },
) {
  const row = await inventoryDb.stockLevel.findFirst({ where: { id: levelId, tenantId } })
  if (!row) throw new ApiError(404, 'Stock level not found')
  return inventoryDb.stockLevel.update({
    where: { id: levelId },
    data: {
      ...(patch.reorderPoint !== undefined ? { reorderPoint: patch.reorderPoint } : {}),
      ...(patch.reorderQty !== undefined ? { reorderQty: patch.reorderQty } : {}),
      ...(patch.leadTimeDays !== undefined ? { leadTimeDays: patch.leadTimeDays } : {}),
      ...(patch.locationId !== undefined ? { locationId: patch.locationId || null } : {}),
    },
  })
}

export async function ensureStockLevel(
  tenantId: string,
  dto: { skuId: string; warehouseId: string; locationId?: string; reorderPoint?: number; reorderQty?: number },
) {
  await findSkuById(tenantId, dto.skuId)
  await findWarehouseById(tenantId, dto.warehouseId)
  return inventoryDb.stockLevel.upsert({
    where: {
      tenantId_skuId_warehouseId_batchId: {
        tenantId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        batchId: '',
      },
    },
    create: {
      id: randomUUID(),
      tenantId,
      skuId: dto.skuId,
      warehouseId: dto.warehouseId,
      locationId: dto.locationId !== undefined ? dto.locationId || null : null,
      batchId: '',
      quantityOnHand: 0,
      quantityReserved: 0,
      quantityAvailable: 0,
      reorderPoint: dto.reorderPoint ?? 0,
      reorderQty: dto.reorderQty ?? 0,
    },
    update: {
      ...(dto.reorderPoint !== undefined ? { reorderPoint: dto.reorderPoint } : {}),
      ...(dto.reorderQty !== undefined ? { reorderQty: dto.reorderQty } : {}),
      ...(dto.locationId !== undefined ? { locationId: dto.locationId || null } : {}),
    },
  })
}

export async function findStockLevel(
  tenantId: string,
  skuId: string,
  warehouseId: string,
  batchId = '',
) {
  return inventoryDb.stockLevel.findFirst({
    where: { tenantId, skuId, warehouseId, batchId },
  })
}

/** Order reservations are long-lived; the safety expiry exists to reap abandoned holds. */
const RESERVATION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function reserveStock(
  tenantId: string,
  dto: { skuId: string; warehouseId: string; quantity: number; orderId: string; correlationId: string; batchId?: string },
): Promise<string> {
  if (!Number.isInteger(dto.quantity) || dto.quantity <= 0) {
    throw new ApiError(400, 'quantity must be a positive integer')
  }
  const batchKey = dto.batchId ?? ''
  const reservationId = randomUUID()

  await inventoryDb.$transaction(async (tx) => {
    const level = await tx.stockLevel.findFirst({
      where: { tenantId, skuId: dto.skuId, warehouseId: dto.warehouseId, batchId: batchKey },
    })
    if (!level || level.quantityAvailable < dto.quantity) {
      throw new ApiError(
        400,
        `Insufficient stock: available ${level?.quantityAvailable ?? 0}, requested ${dto.quantity}`,
      )
    }
    // Conditional update guards against concurrent reservations racing past the check above.
    const updated = await tx.stockLevel.updateMany({
      where: { id: level.id, quantityAvailable: { gte: dto.quantity } },
      data: {
        quantityReserved: { increment: dto.quantity },
        quantityAvailable: { decrement: dto.quantity },
      },
    })
    if (updated.count === 0) {
      throw new ApiError(400, `Insufficient stock: requested ${dto.quantity} no longer available`)
    }
    await tx.stockReservation.create({
      data: {
        id: reservationId,
        tenantId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        batchId: batchKey,
        orderId: dto.orderId,
        quantity: dto.quantity,
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        status: 'ACTIVE',
      },
    })
  })
  queueSalesChannelPush(tenantId, dto.skuId)
  return reservationId
}

/** Reap reservations past their safety expiry, returning stock to availability. */
export async function releaseExpiredReservations(limit = 200): Promise<{ released: number }> {
  const rows = await inventoryDb.stockReservation.findMany({
    where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
    take: limit,
  })
  for (const row of rows) {
    await inventoryDb.$transaction([
      inventoryDb.stockReservation.update({
        where: { id: row.id },
        data: { status: 'EXPIRED' },
      }),
      inventoryDb.stockLevel.updateMany({
        where: {
          tenantId: row.tenantId,
          skuId: row.skuId,
          warehouseId: row.warehouseId,
          batchId: row.batchId ?? '',
        },
        data: {
          quantityReserved: { decrement: row.quantity },
          quantityAvailable: { increment: row.quantity },
        },
      }),
    ])
    queueSalesChannelPush(row.tenantId, row.skuId)
  }
  return { released: rows.length }
}

/**
 * Commit a shipment: decrement on-hand, release the reservation hold, mark reservations
 * FULFILLED, and write STOCK_SHIPPED ledger entries. This is the inventory side of dispatch.
 *
 * `shippedByLine` (optional) caps how much of each reservation actually ships — used for SHORT
 * picks where pickedQty < reserved. The unshipped remainder of a reservation is returned to
 * available stock. When omitted, the full reserved quantity ships.
 */
export async function commitShipmentForOrder(
  tenantId: string,
  orderId: string,
  performedBy: string,
  shippedByLine?: Array<{ skuId: string; warehouseId: string; batchId?: string; quantity: number }>,
  /**
   * The fulfillment task being dispatched. When given, the commit is recorded against it and a
   * repeat call returns the stored result instead of looking for reservations that are already
   * FULFILLED (which would report an empty shipment).
   */
  fulfillmentTaskId?: string,
): Promise<{ shipped: Array<{ skuId: string; warehouseId: string; batchId: string; quantity: number }> }> {
  type ShippedLine = { skuId: string; warehouseId: string; batchId: string; quantity: number }
  const readCommit = async (): Promise<ShippedLine[] | null> => {
    if (!fulfillmentTaskId) return null
    const row = await inventoryDb.shipmentCommit.findFirst({ where: { tenantId, fulfillmentTaskId } })
    return row ? (row.lines as unknown as ShippedLine[]) : null
  }
  const replay = await readCommit()
  if (replay) return { shipped: replay }

  const correlationId = randomUUID()
  const shipped: ShippedLine[] = []

  // Remaining shippable quantity per sku|warehouse|batch from the pick result.
  const cap = new Map<string, number>()
  if (shippedByLine) {
    for (const l of shippedByLine) {
      const key = `${l.skuId}|${l.warehouseId}|${l.batchId ?? ''}`
      cap.set(key, (cap.get(key) ?? 0) + l.quantity)
    }
  }

  let raced: ShippedLine[] | null = null
  await inventoryDb.$transaction(async (tx) => {
    const reservations = await tx.stockReservation.findMany({
      where: { tenantId, orderId, status: 'ACTIVE' },
    })

    for (const res of reservations) {
      const batchKey = res.batchId ?? ''
      const key = `${res.skuId}|${res.warehouseId}|${batchKey}`
      const shipQty = shippedByLine ? Math.min(res.quantity, Math.max(0, cap.get(key) ?? 0)) : res.quantity
      if (shippedByLine) cap.set(key, Math.max(0, (cap.get(key) ?? 0) - shipQty))

      const level = await tx.stockLevel.findFirst({
        where: { tenantId, skuId: res.skuId, warehouseId: res.warehouseId, batchId: batchKey },
        select: { id: true },
      })
      if (!level) {
        throw new ApiError(409, `No stock level for sku ${res.skuId} in warehouse ${res.warehouseId}; cannot ship`)
      }

      // Release the full reservation hold; only `shipQty` actually leaves stock, so the
      // unshipped remainder (res.quantity - shipQty) flows back into availability.
      // The decrement is a single guarded statement, so concurrent shipments cannot overwrite
      // each other and on-hand can never go negative.
      const updated = await tx.stockLevel.updateMany({
        where: { id: level.id, tenantId, quantityOnHand: { gte: shipQty } },
        data: {
          quantityOnHand: { decrement: shipQty },
          quantityReserved: { decrement: res.quantity },
          quantityAvailable: { increment: res.quantity - shipQty },
        },
      })
      if (updated.count !== 1) {
        throw new ApiError(
          409,
          `Insufficient on-hand stock to ship ${shipQty} of sku ${res.skuId} from warehouse ${res.warehouseId}`,
        )
      }

      if (shipQty > 0) {
        // Read back inside the same transaction: the row lock taken by the update above
        // guarantees this is the exact on-hand left by this shipment.
        const after = await tx.stockLevel.findUniqueOrThrow({
          where: { id: level.id },
          select: { quantityOnHand: true },
        })
        await tx.stockLedgerEntry.create({
          data: {
            id: randomUUID(),
            tenantId,
            skuId: res.skuId,
            warehouseId: res.warehouseId,
            batchId: batchKey,
            eventType: 'STOCK_SHIPPED',
            quantityDelta: -shipQty,
            quantityAfter: after.quantityOnHand,
            unitCost: new Prisma.Decimal(0),
            referenceId: orderId,
            referenceType: 'ORDER',
            performedBy,
            correlationId,
          },
        })
      }

      await tx.stockReservation.update({
        where: { id: res.id },
        data: { status: 'FULFILLED' },
      })

      if (shipQty > 0) {
        shipped.push({ skuId: res.skuId, warehouseId: res.warehouseId, batchId: batchKey, quantity: shipQty })
      }
    }

    if (fulfillmentTaskId) {
      await tx.shipmentCommit.create({
        data: { tenantId, fulfillmentTaskId, orderId, lines: shipped as unknown as Prisma.InputJsonValue },
      })
    }
  }).catch(async (err: unknown) => {
    // A concurrent call for the same task committed first; return what it stored.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await readCommit()
      if (winner) {
        raced = winner
        return
      }
    }
    throw err
  })
  const racedResult = raced as ShippedLine[] | null
  if (racedResult) return { shipped: racedResult }

  for (const line of shipped) {
    queueSalesChannelPush(tenantId, line.skuId)
  }
  return { shipped }
}

export async function releaseReservation(tenantId: string, reservationId: string): Promise<void> {
  const reservation = await inventoryDb.stockReservation.findFirst({
    where: { id: reservationId, tenantId, status: 'ACTIVE' },
  })
  if (!reservation) return
  await inventoryDb.$transaction([
    inventoryDb.stockReservation.update({
      where: { id: reservationId },
      data: { status: 'RELEASED' },
    }),
    inventoryDb.stockLevel.updateMany({
      where: {
        tenantId,
        skuId: reservation.skuId,
        warehouseId: reservation.warehouseId,
        batchId: reservation.batchId ?? '',
      },
      data: {
        quantityReserved: { decrement: reservation.quantity },
        quantityAvailable: { increment: reservation.quantity },
      },
    }),
  ])
  queueSalesChannelPush(tenantId, reservation.skuId)
}

export async function releaseReservationsForOrder(tenantId: string, orderId: string): Promise<void> {
  const rows = await inventoryDb.stockReservation.findMany({
    where: { tenantId, orderId, status: 'ACTIVE' },
  })
  for (const row of rows) {
    await releaseReservation(tenantId, row.id)
  }
}

export async function lowStockAlerts(tenantId: string) {
  const rows = await inventoryDb.stockLevel.findMany({
    where: { tenantId, reorderPoint: { gt: 0 } },
    take: 500,
  })
  const low = rows.filter((r) => r.quantityAvailable <= r.reorderPoint)
  const skuIds = [...new Set(low.map((r) => r.skuId))]
  const skus =
    skuIds.length > 0
      ? await inventoryDb.sKU.findMany({ where: { id: { in: skuIds }, tenantId } })
      : []
  const skuMeta = new Map(skus.map((s) => [s.id, { name: s.name, code: s.code }]))
  return {
    lowStock: low.slice(0, 50).map((r) => ({
      skuId: r.skuId,
      code: skuMeta.get(r.skuId)?.code ?? r.skuId,
      name: skuMeta.get(r.skuId)?.name ?? r.skuId,
      available: r.quantityAvailable,
      reorderPoint: r.reorderPoint,
    })),
  }
}
