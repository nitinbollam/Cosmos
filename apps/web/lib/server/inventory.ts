import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-inventory'
import { inventoryDb } from './db'
import { ApiError } from './session'

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

export async function findSkuById(tenantId: string, id: string) {
  const sku = await inventoryDb.sKU.findFirst({ where: { id, tenantId } })
  if (!sku) throw new ApiError(404, 'SKU not found')
  return sku
}

export async function getSkuReorderSuggestion(tenantId: string, skuId: string, warehouseId?: string) {
  const sku = await findSkuById(tenantId, skuId)
  const level = await inventoryDb.stockLevel.findFirst({
    where: {
      tenantId,
      skuId,
      ...(warehouseId ? { warehouseId } : {}),
    },
    orderBy: { reorderPoint: 'desc' },
  })
  const reorderQty = level?.reorderQty && level.reorderQty > 0 ? level.reorderQty : Math.max(1, (level?.reorderPoint ?? 0) * 2 || 10)
  return {
    sku: { id: sku.id, code: sku.code, name: sku.name, cost: Number(sku.cost ?? 0) },
    warehouseId: level?.warehouseId ?? warehouseId ?? null,
    quantityAvailable: level?.quantityAvailable ?? 0,
    reorderPoint: level?.reorderPoint ?? 0,
    suggestedQty: reorderQty,
  }
}

export async function findSkuByCode(tenantId: string, code: string) {
  const sku = await inventoryDb.sKU.findFirst({
    where: { tenantId, code: { equals: code.trim() } },
  })
  if (!sku) throw new ApiError(404, `SKU code not found: ${code}`)
  return sku
}

/** Code or barcode — receiving / warehouse scans. */
export async function findSkuByScanValue(tenantId: string, raw: string) {
  const v = raw.trim()
  if (!v) throw new ApiError(400, 'scan value required')
  const byCode = await inventoryDb.sKU.findFirst({
    where: { tenantId, code: { equals: v }, isActive: true },
  })
  if (byCode) return byCode
  const byBar = await inventoryDb.sKU.findFirst({
    where: { tenantId, barcode: v, isActive: true },
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
  await findSkuById(tenantId, dto.skuId)
  await findWarehouseById(tenantId, dto.warehouseId)
  const correlationId = randomUUID()
  const entryId = randomUUID()
  const batchKey = dto.batchId ?? ''

  return inventoryDb.$transaction(async (tx) => {
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

    const fromOnHand = from.quantityOnHand - dto.quantity
    await tx.stockLevel.update({
      where: { id: from.id },
      data: {
        quantityOnHand: fromOnHand,
        quantityAvailable: from.quantityAvailable - dto.quantity,
      },
    })

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
    return await inventoryDb.sKU.update({
      where: { id },
      data: {
        ...(patch.code !== undefined ? { code: patch.code } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.cost !== undefined ? { cost: new Prisma.Decimal(+patch.cost) } : {}),
        ...(patch.price !== undefined ? { price: new Prisma.Decimal(+patch.price) } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    })
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

export function listWarehouses(tenantId: string) {
  return inventoryDb.warehouse.findMany({ where: { tenantId } })
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
    const newOnHand = level.quantityOnHand + dto.quantityDelta
    if (newOnHand < 0) throw new ApiError(400, 'Adjustment would drive stock negative')
    if (newOnHand < level.quantityReserved) {
      throw new ApiError(400, 'Adjustment would leave less on hand than reserved quantity')
    }

    const updatedLevel = await tx.stockLevel.update({
      where: { id: level.id },
      data: {
        quantityOnHand: newOnHand,
        quantityAvailable: { increment: dto.quantityDelta },
        ...(dto.locationId !== undefined ? { locationId: dto.locationId || null } : {}),
      },
    })
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
    ).catch(() => undefined)
  }

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
  patch: { reorderPoint?: number; reorderQty?: number; locationId?: string | null },
) {
  const row = await inventoryDb.stockLevel.findFirst({ where: { id: levelId, tenantId } })
  if (!row) throw new ApiError(404, 'Stock level not found')
  return inventoryDb.stockLevel.update({
    where: { id: levelId },
    data: {
      ...(patch.reorderPoint !== undefined ? { reorderPoint: patch.reorderPoint } : {}),
      ...(patch.reorderQty !== undefined ? { reorderQty: patch.reorderQty } : {}),
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

export async function reserveStock(
  tenantId: string,
  dto: { skuId: string; warehouseId: string; quantity: number; orderId: string; correlationId: string; batchId?: string },
): Promise<string> {
  const batchKey = dto.batchId ?? ''
  const level = await inventoryDb.stockLevel.findFirst({
    where: { tenantId, skuId: dto.skuId, warehouseId: dto.warehouseId, batchId: batchKey },
  })
  if (!level || level.quantityAvailable < dto.quantity) {
    throw new ApiError(
      400,
      `Insufficient stock: available ${level?.quantityAvailable ?? 0}, requested ${dto.quantity}`,
    )
  }
  const reservationId = randomUUID()
  await inventoryDb.$transaction([
    inventoryDb.stockLevel.update({
      where: { id: level.id },
      data: {
        quantityReserved: { increment: dto.quantity },
        quantityAvailable: { decrement: dto.quantity },
      },
    }),
    inventoryDb.stockReservation.create({
      data: {
        id: reservationId,
        tenantId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        batchId: batchKey,
        orderId: dto.orderId,
        quantity: dto.quantity,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        status: 'ACTIVE',
      },
    }),
  ])
  return reservationId
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
  const skuName = new Map(skus.map((s) => [s.id, s.name]))
  return {
    lowStock: low.slice(0, 50).map((r) => ({
      skuId: r.skuId,
      name: skuName.get(r.skuId) ?? r.skuId,
      available: r.quantityAvailable,
      reorderPoint: r.reorderPoint,
    })),
  }
}
