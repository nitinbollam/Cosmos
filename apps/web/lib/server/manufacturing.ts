import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-inventory'
import { inventoryDb } from './db'
import { ApiError } from './session'

export interface CreateBomItemInput {
  componentSkuId: string
  quantity: number | string
  scrapFactorPercent?: number | string
  notes?: string
}

export interface CreateBomInput {
  skuId: string
  name: string
  description?: string
  version?: string
  status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
  laborCost?: number | string
  overheadCost?: number | string
  notes?: string
  items: CreateBomItemInput[]
}

export interface UpdateBomInput {
  name?: string
  description?: string
  version?: string
  status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
  laborCost?: number | string
  overheadCost?: number | string
  notes?: string
  items?: CreateBomItemInput[]
}

export interface CreateAssemblyOrderInput {
  bomId: string
  warehouseId: string
  quantityPlanned: number
  destinationBinId?: string
  notes?: string
}

export interface CompleteAssemblyOrderInput {
  destinationBinId?: string
  batchId?: string
  notes?: string
}

export interface DisassembleKitInput {
  skuId: string
  bomId: string
  warehouseId: string
  quantity: number
  notes?: string
}

// -----------------------------------------------------------------------------
// BOM Operations
// -----------------------------------------------------------------------------

export async function listBoms(
  tenantId: string,
  filter?: { skuId?: string; status?: string; search?: string },
) {
  const where: Prisma.BillOfMaterialsWhereInput = { tenantId }

  if (filter?.skuId) {
    where.skuId = filter.skuId
  }
  if (filter?.status) {
    where.status = filter.status
  }
  if (filter?.search) {
    where.OR = [
      { name: { contains: filter.search } },
      { bomNumber: { contains: filter.search } },
      { description: { contains: filter.search } },
    ]
  }

  const boms = await inventoryDb.billOfMaterials.findMany({
    where,
    include: {
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  // Fetch SKU metadata for finished goods and components
  const allSkuIds = new Set<string>()
  for (const bom of boms) {
    allSkuIds.add(bom.skuId)
    for (const item of bom.items) {
      allSkuIds.add(item.componentSkuId)
    }
  }

  const skus = await inventoryDb.sKU.findMany({
    where: {
      tenantId,
      id: { in: Array.from(allSkuIds) },
    },
  })
  const skuMap = new Map(skus.map((s) => [s.id, s]))

  return boms.map((bom) => {
    const finishedGood = skuMap.get(bom.skuId)
    let totalComponentCost = new Prisma.Decimal(0)

    const enrichedItems = bom.items.map((item) => {
      const compSku = skuMap.get(item.componentSkuId)
      const compCost = compSku?.cost ?? new Prisma.Decimal(0)
      const qty = new Prisma.Decimal(item.quantity)
      const scrapMultiplier = new Prisma.Decimal(1).add(
        new Prisma.Decimal(item.scrapFactorPercent).div(100),
      )
      const effectiveQty = qty.mul(scrapMultiplier)
      const lineCost = effectiveQty.mul(compCost)
      totalComponentCost = totalComponentCost.add(lineCost)

      return {
        ...item,
        quantity: Number(item.quantity),
        scrapFactorPercent: Number(item.scrapFactorPercent),
        componentSku: compSku
          ? {
              id: compSku.id,
              code: compSku.code,
              name: compSku.name,
              category: compSku.category,
              cost: Number(compSku.cost),
              price: Number(compSku.price),
              unitOfMeasure: compSku.unitOfMeasure,
            }
          : null,
        effectiveQuantity: Number(effectiveQty),
        estimatedLineCost: Number(lineCost),
      }
    })

    const labor = new Prisma.Decimal(bom.laborCost)
    const overhead = new Prisma.Decimal(bom.overheadCost)
    const rolledUpUnitCost = totalComponentCost.add(labor).add(overhead)

    return {
      ...bom,
      laborCost: Number(bom.laborCost),
      overheadCost: Number(bom.overheadCost),
      estimatedUnitCost: Number(rolledUpUnitCost),
      finishedGood: finishedGood
        ? {
            id: finishedGood.id,
            code: finishedGood.code,
            name: finishedGood.name,
            category: finishedGood.category,
            price: Number(finishedGood.price),
            cost: Number(finishedGood.cost),
            unitOfMeasure: finishedGood.unitOfMeasure,
          }
        : null,
      items: enrichedItems,
    }
  })
}

export async function getBomById(tenantId: string, bomId: string) {
  const bom = await inventoryDb.billOfMaterials.findFirst({
    where: { id: bomId, tenantId },
    include: {
      items: true,
    },
  })
  if (!bom) throw new ApiError(404, 'Bill of Materials not found')

  const skuIds = [bom.skuId, ...bom.items.map((i) => i.componentSkuId)]
  const skus = await inventoryDb.sKU.findMany({
    where: {
      tenantId,
      id: { in: skuIds },
    },
  })
  const skuMap = new Map(skus.map((s) => [s.id, s]))

  // Fetch stock levels for component parts across warehouses
  const stockLevels = await inventoryDb.stockLevel.findMany({
    where: {
      tenantId,
      skuId: { in: bom.items.map((i) => i.componentSkuId) },
    },
  })

  const stockBySkuAndWarehouse = new Map<string, number>()
  for (const sl of stockLevels) {
    const key = `${sl.skuId}:${sl.warehouseId}`
    const cur = stockBySkuAndWarehouse.get(key) ?? 0
    stockBySkuAndWarehouse.set(key, cur + sl.quantityAvailable)
  }

  let totalComponentCost = new Prisma.Decimal(0)

  const enrichedItems = bom.items.map((item) => {
    const compSku = skuMap.get(item.componentSkuId)
    const compCost = compSku?.cost ?? new Prisma.Decimal(0)
    const qty = new Prisma.Decimal(item.quantity)
    const scrapMultiplier = new Prisma.Decimal(1).add(
      new Prisma.Decimal(item.scrapFactorPercent).div(100),
    )
    const effectiveQty = qty.mul(scrapMultiplier)
    const lineCost = effectiveQty.mul(compCost)
    totalComponentCost = totalComponentCost.add(lineCost)

    return {
      ...item,
      quantity: Number(item.quantity),
      scrapFactorPercent: Number(item.scrapFactorPercent),
      componentSku: compSku
        ? {
            id: compSku.id,
            code: compSku.code,
            name: compSku.name,
            category: compSku.category,
            cost: Number(compSku.cost),
            price: Number(compSku.price),
            unitOfMeasure: compSku.unitOfMeasure,
          }
        : null,
      effectiveQuantity: Number(effectiveQty),
      estimatedLineCost: Number(lineCost),
    }
  })

  const finishedGood = skuMap.get(bom.skuId)
  const labor = new Prisma.Decimal(bom.laborCost)
  const overhead = new Prisma.Decimal(bom.overheadCost)
  const rolledUpUnitCost = totalComponentCost.add(labor).add(overhead)

  return {
    ...bom,
    laborCost: Number(bom.laborCost),
    overheadCost: Number(bom.overheadCost),
    totalComponentCost: Number(totalComponentCost),
    estimatedUnitCost: Number(rolledUpUnitCost),
    finishedGood: finishedGood
      ? {
          id: finishedGood.id,
          code: finishedGood.code,
          name: finishedGood.name,
          category: finishedGood.category,
          price: Number(finishedGood.price),
          cost: Number(finishedGood.cost),
          unitOfMeasure: finishedGood.unitOfMeasure,
        }
      : null,
    items: enrichedItems,
  }
}

export async function createBom(
  tenantId: string,
  input: CreateBomInput,
  _userId: string,
) {
  if (!input.skuId) throw new ApiError(400, 'Finished good skuId is required')
  if (!input.name?.trim()) throw new ApiError(400, 'BOM name is required')
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ApiError(400, 'At least one component item is required in the BOM')
  }

  // Validate finished good SKU exists
  const finishedSku = await inventoryDb.sKU.findFirst({
    where: { id: input.skuId, tenantId },
  })
  if (!finishedSku) throw new ApiError(404, 'Finished good SKU not found')

  // Validate no circular dependency (finished good cannot be its own component)
  for (const item of input.items) {
    if (item.componentSkuId === input.skuId) {
      throw new ApiError(400, 'A finished good cannot be used as a component of itself')
    }
    const qty = Number(item.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ApiError(400, 'Component quantity must be greater than zero')
    }
  }

  // Validate all component SKUs exist
  const compSkuIds = input.items.map((i) => i.componentSkuId)
  const compSkus = await inventoryDb.sKU.findMany({
    where: { tenantId, id: { in: compSkuIds } },
  })
  if (compSkus.length !== compSkuIds.length) {
    throw new ApiError(400, 'One or more component SKUs do not exist')
  }

  const bomNumber = `BOM-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`

  return await inventoryDb.$transaction(async (tx) => {
    // Flag finished good SKU as a kit/assembled item
    await tx.sKU.update({
      where: { id: input.skuId },
      data: { isKit: true },
    })

    const bom = await tx.billOfMaterials.create({
      data: {
        id: randomUUID(),
        tenantId,
        skuId: input.skuId,
        bomNumber,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        version: input.version?.trim() || '1.0',
        status: input.status ?? 'ACTIVE',
        laborCost: new Prisma.Decimal(input.laborCost ?? 0),
        overheadCost: new Prisma.Decimal(input.overheadCost ?? 0),
        notes: input.notes?.trim() || null,
        items: {
          create: input.items.map((i) => ({
            id: randomUUID(),
            tenantId,
            componentSkuId: i.componentSkuId,
            quantity: new Prisma.Decimal(i.quantity),
            scrapFactorPercent: new Prisma.Decimal(i.scrapFactorPercent ?? 0),
            notes: i.notes?.trim() || null,
          })),
        },
      },
      include: {
        items: true,
      },
    })
    return bom
  })
}

export async function updateBom(
  tenantId: string,
  bomId: string,
  input: UpdateBomInput,
  _userId: string,
) {
  const existing = await inventoryDb.billOfMaterials.findFirst({
    where: { id: bomId, tenantId },
    include: { items: true },
  })
  if (!existing) throw new ApiError(404, 'Bill of Materials not found')

  if (input.items) {
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new ApiError(400, 'BOM must contain at least one component item')
    }
    for (const item of input.items) {
      if (item.componentSkuId === existing.skuId) {
        throw new ApiError(400, 'A finished good cannot be used as a component of itself')
      }
      const qty = Number(item.quantity)
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new ApiError(400, 'Component quantity must be greater than zero')
      }
    }
  }

  return await inventoryDb.$transaction(async (tx) => {
    if (input.items) {
      await tx.bomItem.deleteMany({
        where: { bomId, tenantId },
      })
      await tx.bomItem.createMany({
        data: input.items.map((i) => ({
          id: randomUUID(),
          tenantId,
          bomId,
          componentSkuId: i.componentSkuId,
          quantity: new Prisma.Decimal(i.quantity),
          scrapFactorPercent: new Prisma.Decimal(i.scrapFactorPercent ?? 0),
          notes: i.notes?.trim() || null,
        })),
      })
    }

    const updated = await tx.billOfMaterials.update({
      where: { id: bomId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
        ...(input.version !== undefined ? { version: input.version.trim() } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.laborCost !== undefined ? { laborCost: new Prisma.Decimal(input.laborCost) } : {}),
        ...(input.overheadCost !== undefined ? { overheadCost: new Prisma.Decimal(input.overheadCost) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
      },
      include: {
        items: true,
      },
    })
    return updated
  })
}

export async function deleteBom(tenantId: string, bomId: string) {
  const existing = await inventoryDb.billOfMaterials.findFirst({
    where: { id: bomId, tenantId },
  })
  if (!existing) throw new ApiError(404, 'Bill of Materials not found')

  const activeOrders = await inventoryDb.assemblyOrder.count({
    where: { bomId, tenantId, status: { in: ['RELEASED', 'IN_PROGRESS', 'COMPLETED'] } },
  })
  if (activeOrders > 0) {
    throw new ApiError(
      400,
      'Cannot delete a BOM that has active or completed assembly orders. Archive it instead.',
    )
  }

  await inventoryDb.billOfMaterials.delete({
    where: { id: bomId },
  })
  return { success: true }
}

// -----------------------------------------------------------------------------
// Assembly & Work Order Operations
// -----------------------------------------------------------------------------

export async function listAssemblyOrders(
  tenantId: string,
  filter?: { status?: string; warehouseId?: string; skuId?: string },
) {
  const where: Prisma.AssemblyOrderWhereInput = { tenantId }
  if (filter?.status) where.status = filter.status
  if (filter?.warehouseId) where.warehouseId = filter.warehouseId
  if (filter?.skuId) where.skuId = filter.skuId

  const orders = await inventoryDb.assemblyOrder.findMany({
    where,
    include: {
      bom: true,
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const skuIds = new Set<string>()
  const warehouseIds = new Set<string>()

  for (const o of orders) {
    skuIds.add(o.skuId)
    warehouseIds.add(o.warehouseId)
    for (const item of o.items) {
      skuIds.add(item.componentSkuId)
    }
  }

  const [skus, warehouses] = await Promise.all([
    inventoryDb.sKU.findMany({
      where: { tenantId, id: { in: Array.from(skuIds) } },
    }),
    inventoryDb.warehouse.findMany({
      where: { tenantId, id: { in: Array.from(warehouseIds) } },
    }),
  ])

  const skuMap = new Map(skus.map((s) => [s.id, s]))
  const whMap = new Map(warehouses.map((w) => [w.id, w]))

  return orders.map((o) => {
    const finishedGood = skuMap.get(o.skuId)
    const wh = whMap.get(o.warehouseId)
    return {
      ...o,
      unitCost: o.unitCost ? Number(o.unitCost) : null,
      totalCost: o.totalCost ? Number(o.totalCost) : null,
      finishedGood: finishedGood
        ? {
            id: finishedGood.id,
            code: finishedGood.code,
            name: finishedGood.name,
            unitOfMeasure: finishedGood.unitOfMeasure,
          }
        : null,
      warehouse: wh ? { id: wh.id, code: wh.code, name: wh.name } : null,
      itemsCount: o.items.length,
    }
  })
}

export async function getAssemblyOrder(tenantId: string, orderId: string) {
  const order = await inventoryDb.assemblyOrder.findFirst({
    where: { id: orderId, tenantId },
    include: {
      bom: {
        include: { items: true },
      },
      items: true,
    },
  })
  if (!order) throw new ApiError(404, 'Assembly order not found')

  const skuIds = [order.skuId, ...order.items.map((i) => i.componentSkuId)]
  const [skus, warehouse, stockLevels] = await Promise.all([
    inventoryDb.sKU.findMany({
      where: { tenantId, id: { in: skuIds } },
    }),
    inventoryDb.warehouse.findFirst({
      where: { tenantId, id: order.warehouseId },
    }),
    inventoryDb.stockLevel.findMany({
      where: {
        tenantId,
        warehouseId: order.warehouseId,
        skuId: { in: order.items.map((i) => i.componentSkuId) },
      },
    }),
  ])

  const skuMap = new Map(skus.map((s) => [s.id, s]))
  const stockMap = new Map<string, number>()
  for (const sl of stockLevels) {
    const cur = stockMap.get(sl.skuId) ?? 0
    stockMap.set(sl.skuId, cur + sl.quantityAvailable)
  }

  let allAvailable = true

  const enrichedItems = order.items.map((item) => {
    const compSku = skuMap.get(item.componentSkuId)
    const required = Number(item.quantityRequired)
    const consumed = Number(item.quantityConsumed)
    const available = stockMap.get(item.componentSkuId) ?? 0
    const shortage = order.status === 'COMPLETED' ? 0 : Math.max(0, required - available)
    if (shortage > 0) allAvailable = false

    return {
      ...item,
      quantityRequired: required,
      quantityConsumed: consumed,
      unitCost: Number(item.unitCost),
      totalCost: Number(item.totalCost),
      stockAvailableInWarehouse: available,
      shortage,
      componentSku: compSku
        ? {
            id: compSku.id,
            code: compSku.code,
            name: compSku.name,
            category: compSku.category,
            cost: Number(compSku.cost),
            unitOfMeasure: compSku.unitOfMeasure,
          }
        : null,
    }
  })

  const finishedGood = skuMap.get(order.skuId)

  return {
    ...order,
    unitCost: order.unitCost ? Number(order.unitCost) : null,
    totalCost: order.totalCost ? Number(order.totalCost) : null,
    finishedGood: finishedGood
      ? {
          id: finishedGood.id,
          code: finishedGood.code,
          name: finishedGood.name,
          category: finishedGood.category,
          price: Number(finishedGood.price),
          cost: Number(finishedGood.cost),
          unitOfMeasure: finishedGood.unitOfMeasure,
        }
      : null,
    warehouse: warehouse
      ? { id: warehouse.id, code: warehouse.code, name: warehouse.name }
      : null,
    items: enrichedItems,
    canAssemble: allAvailable,
  }
}

export async function createAssemblyOrder(
  tenantId: string,
  input: CreateAssemblyOrderInput,
  userId: string,
) {
  if (!input.bomId) throw new ApiError(400, 'bomId is required')
  if (!input.warehouseId) throw new ApiError(400, 'warehouseId is required')
  const qty = Math.floor(Number(input.quantityPlanned))
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new ApiError(400, 'quantityPlanned must be a positive integer')
  }

  const [bom, warehouse] = await Promise.all([
    inventoryDb.billOfMaterials.findFirst({
      where: { id: input.bomId, tenantId },
      include: { items: true },
    }),
    inventoryDb.warehouse.findFirst({
      where: { id: input.warehouseId, tenantId },
    }),
  ])

  if (!bom) throw new ApiError(404, 'BOM not found')
  if (bom.status !== 'ACTIVE') {
    throw new ApiError(400, `Cannot create order against BOM in ${bom.status} status`)
  }
  if (!warehouse) throw new ApiError(404, 'Warehouse not found')

  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString()
  const orderNumber = `ASM-${datePrefix}-${randomSuffix}`

  return await inventoryDb.assemblyOrder.create({
    data: {
      id: randomUUID(),
      tenantId,
      orderNumber,
      bomId: bom.id,
      skuId: bom.skuId,
      warehouseId: input.warehouseId,
      destinationBinId: input.destinationBinId || null,
      quantityPlanned: qty,
      quantityCompleted: 0,
      status: 'DRAFT',
      notes: input.notes?.trim() || null,
      createdBy: userId,
      items: {
        create: bom.items.map((bi) => {
          const itemQty = new Prisma.Decimal(bi.quantity)
          const scrapMultiplier = new Prisma.Decimal(1).add(
            new Prisma.Decimal(bi.scrapFactorPercent).div(100),
          )
          const totalRequired = itemQty.mul(scrapMultiplier).mul(qty)
          return {
            id: randomUUID(),
            tenantId,
            componentSkuId: bi.componentSkuId,
            quantityRequired: totalRequired,
            quantityConsumed: 0,
            unitCost: 0,
            totalCost: 0,
          }
        }),
      },
    },
    include: {
      items: true,
      bom: true,
    },
  })
}

export async function releaseAssemblyOrder(
  tenantId: string,
  orderId: string,
  _userId: string,
) {
  const order = await inventoryDb.assemblyOrder.findFirst({
    where: { id: orderId, tenantId },
  })
  if (!order) throw new ApiError(404, 'Assembly order not found')
  if (order.status !== 'DRAFT') {
    throw new ApiError(400, `Cannot release assembly order in ${order.status} status`)
  }

  return await inventoryDb.assemblyOrder.update({
    where: { id: orderId },
    data: {
      status: 'RELEASED',
      startedAt: new Date(),
    },
  })
}

/**
 * Executes the atomic assembly of finished goods from components:
 * 1. Validates all component quantities are in stock in the designated warehouse.
 * 2. Deducts each component from stock level and creates KIT_ASSEMBLY_CONSUME ledger entries.
 * 3. Increments finished good stock level and creates KIT_ASSEMBLY_PRODUCE ledger entry.
 * 4. Calculates rolled-up actual unit cost and marks order COMPLETED.
 */
export async function completeAssemblyOrder(
  tenantId: string,
  orderId: string,
  input: CompleteAssemblyOrderInput,
  userId: string,
) {
  const order = await inventoryDb.assemblyOrder.findFirst({
    where: { id: orderId, tenantId },
    include: {
      bom: true,
      items: true,
    },
  })
  if (!order) throw new ApiError(404, 'Assembly order not found')
  if (order.status === 'COMPLETED') {
    throw new ApiError(400, 'Assembly order is already completed')
  }
  if (order.status === 'CANCELLED') {
    throw new ApiError(400, 'Cannot complete a cancelled assembly order')
  }

  const correlationId = randomUUID()

  // Load component SKUs and warehouse stock levels
  const compSkuIds = order.items.map((i) => i.componentSkuId)
  const [componentSkus, stockLevels, finishedGoodSku] = await Promise.all([
    inventoryDb.sKU.findMany({
      where: { tenantId, id: { in: compSkuIds } },
    }),
    inventoryDb.stockLevel.findMany({
      where: {
        tenantId,
        warehouseId: order.warehouseId,
        skuId: { in: compSkuIds },
      },
    }),
    inventoryDb.sKU.findFirst({
      where: { tenantId, id: order.skuId },
    }),
  ])

  if (!finishedGoodSku) throw new ApiError(404, 'Finished good SKU not found')
  const compSkuMap = new Map(componentSkus.map((s) => [s.id, s]))

  // Check stock availability
  const stockMap = new Map<string, { id: string; available: number; onHand: number }>()
  for (const sl of stockLevels) {
    const cur = stockMap.get(sl.skuId) ?? { id: sl.id, available: 0, onHand: 0 }
    stockMap.set(sl.skuId, {
      id: sl.id,
      available: cur.available + sl.quantityAvailable,
      onHand: cur.onHand + sl.quantityOnHand,
    })
  }

  const shortages: string[] = []
  for (const item of order.items) {
    const needed = Math.ceil(Number(item.quantityRequired))
    const current = stockMap.get(item.componentSkuId)
    const available = current ? current.available : 0
    if (available < needed) {
      const comp = compSkuMap.get(item.componentSkuId)
      shortages.push(
        `${comp?.code ?? item.componentSkuId} (needed: ${needed}, available: ${available})`,
      )
    }
  }

  if (shortages.length > 0) {
    throw new ApiError(
      400,
      `Insufficient component inventory to complete assembly: ${shortages.join('; ')}`,
    )
  }

  return await inventoryDb.$transaction(async (tx) => {
    let totalComponentCost = new Prisma.Decimal(0)

    // 1. Consume component parts
    for (const item of order.items) {
      const comp = compSkuMap.get(item.componentSkuId)
      const compCost = comp?.cost ?? new Prisma.Decimal(0)
      const qtyToConsume = Math.ceil(Number(item.quantityRequired))
      const lineCost = compCost.mul(qtyToConsume)
      totalComponentCost = totalComponentCost.add(lineCost)

      // Find stock level record
      const sl = await tx.stockLevel.findFirst({
        where: {
          tenantId,
          warehouseId: order.warehouseId,
          skuId: item.componentSkuId,
        },
      })
      if (!sl || sl.quantityOnHand < qtyToConsume) {
        throw new ApiError(400, `Stock depleted for component ${comp?.code ?? item.componentSkuId}`)
      }

      const newOnHand = sl.quantityOnHand - qtyToConsume
      await tx.stockLevel.update({
        where: { id: sl.id },
        data: {
          quantityOnHand: newOnHand,
          quantityAvailable: { decrement: qtyToConsume },
        },
      })

      // Record consumption ledger entry
      await tx.stockLedgerEntry.create({
        data: {
          id: randomUUID(),
          tenantId,
          skuId: item.componentSkuId,
          warehouseId: order.warehouseId,
          locationId: sl.locationId,
          batchId: sl.batchId,
          eventType: 'KIT_ASSEMBLY_CONSUME',
          quantityDelta: -qtyToConsume,
          quantityAfter: newOnHand,
          unitCost: compCost,
          referenceId: order.id,
          referenceType: 'ASSEMBLY_ORDER',
          performedBy: userId,
          correlationId,
        },
      })

      // Update order line item
      await tx.assemblyOrderItem.update({
        where: { id: item.id },
        data: {
          quantityConsumed: new Prisma.Decimal(qtyToConsume),
          unitCost: compCost,
          totalCost: lineCost,
        },
      })
    }

    // 2. Calculate rolled-up unit cost for finished goods
    const labor = new Prisma.Decimal(order.bom.laborCost)
    const overhead = new Prisma.Decimal(order.bom.overheadCost)
    const totalOrderCost = totalComponentCost.add(labor.mul(order.quantityPlanned)).add(
      overhead.mul(order.quantityPlanned),
    )
    const unitCost = totalOrderCost.div(order.quantityPlanned)

    // 3. Increment finished good inventory
    const batchKey = input.batchId ?? ''
    let fgStockLevel = await tx.stockLevel.findFirst({
      where: {
        tenantId,
        warehouseId: order.warehouseId,
        skuId: order.skuId,
        batchId: batchKey,
      },
    })

    let newFgOnHand = order.quantityPlanned
    if (fgStockLevel) {
      newFgOnHand = fgStockLevel.quantityOnHand + order.quantityPlanned
      await tx.stockLevel.update({
        where: { id: fgStockLevel.id },
        data: {
          quantityOnHand: newFgOnHand,
          quantityAvailable: { increment: order.quantityPlanned },
          ...(input.destinationBinId ? { locationId: input.destinationBinId } : {}),
        },
      })
    } else {
      fgStockLevel = await tx.stockLevel.create({
        data: {
          id: randomUUID(),
          tenantId,
          skuId: order.skuId,
          warehouseId: order.warehouseId,
          batchId: batchKey,
          locationId: input.destinationBinId || null,
          quantityOnHand: order.quantityPlanned,
          quantityAvailable: order.quantityPlanned,
          quantityReserved: 0,
        },
      })
    }

    // Record production ledger entry for finished good
    await tx.stockLedgerEntry.create({
      data: {
        id: randomUUID(),
        tenantId,
        skuId: order.skuId,
        warehouseId: order.warehouseId,
        locationId: input.destinationBinId || fgStockLevel.locationId,
        batchId: batchKey,
        eventType: 'KIT_ASSEMBLY_PRODUCE',
        quantityDelta: order.quantityPlanned,
        quantityAfter: newFgOnHand,
        unitCost,
        referenceId: order.id,
        referenceType: 'ASSEMBLY_ORDER',
        performedBy: userId,
        correlationId,
      },
    })

    // Optionally update SKU cost to new production cost
    await tx.sKU.update({
      where: { id: order.skuId },
      data: {
        cost: unitCost,
        isKit: true,
      },
    })

    // 4. Update Assembly Order to COMPLETED
    const completedOrder = await tx.assemblyOrder.update({
      where: { id: order.id },
      data: {
        status: 'COMPLETED',
        quantityCompleted: order.quantityPlanned,
        unitCost,
        totalCost: totalOrderCost,
        completedAt: new Date(),
        completedBy: userId,
        ...(input.destinationBinId ? { destinationBinId: input.destinationBinId } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      },
      include: {
        bom: true,
        items: true,
      },
    })

    return {
      order: completedOrder,
      unitCost: Number(unitCost),
      totalCost: Number(totalOrderCost),
      quantityAssembled: order.quantityPlanned,
      correlationId,
    }
  })
}

export async function cancelAssemblyOrder(
  tenantId: string,
  orderId: string,
  reason: string | undefined,
  _userId: string,
) {
  const order = await inventoryDb.assemblyOrder.findFirst({
    where: { id: orderId, tenantId },
  })
  if (!order) throw new ApiError(404, 'Assembly order not found')
  if (order.status === 'COMPLETED') {
    throw new ApiError(400, 'Cannot cancel a completed assembly order. Use Disassemble / Dekit instead.')
  }

  return await inventoryDb.assemblyOrder.update({
    where: { id: orderId },
    data: {
      status: 'CANCELLED',
      notes: reason ? `${order.notes ? `${order.notes} | ` : ''}Cancelled: ${reason}` : order.notes,
    },
  })
}

/**
 * Disassemble / Dekitting:
 * Disassembles finished goods back into their raw components.
 * Deducts finished goods stock and restores component parts to warehouse.
 */
export async function disassembleKit(
  tenantId: string,
  input: DisassembleKitInput,
  userId: string,
) {
  const qty = Math.floor(Number(input.quantity))
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new ApiError(400, 'quantity must be a positive integer')
  }

  const [bom, warehouse, finishedSku] = await Promise.all([
    inventoryDb.billOfMaterials.findFirst({
      where: { id: input.bomId, tenantId, skuId: input.skuId },
      include: { items: true },
    }),
    inventoryDb.warehouse.findFirst({
      where: { id: input.warehouseId, tenantId },
    }),
    inventoryDb.sKU.findFirst({
      where: { id: input.skuId, tenantId },
    }),
  ])

  if (!bom) throw new ApiError(404, 'BOM not found for finished good SKU')
  if (!warehouse) throw new ApiError(404, 'Warehouse not found')
  if (!finishedSku) throw new ApiError(404, 'Finished good SKU not found')

  const correlationId = randomUUID()

  return await inventoryDb.$transaction(async (tx) => {
    // 1. Verify finished good stock availability
    const fgStock = await tx.stockLevel.findFirst({
      where: {
        tenantId,
        warehouseId: input.warehouseId,
        skuId: input.skuId,
      },
    })
    if (!fgStock || fgStock.quantityAvailable < qty) {
      throw new ApiError(
        400,
        `Insufficient finished goods stock to disassemble (available: ${fgStock?.quantityAvailable ?? 0}, requested: ${qty})`,
      )
    }

    const newFgOnHand = fgStock.quantityOnHand - qty
    await tx.stockLevel.update({
      where: { id: fgStock.id },
      data: {
        quantityOnHand: newFgOnHand,
        quantityAvailable: { decrement: qty },
      },
    })

    // Finished good consumption ledger entry
    await tx.stockLedgerEntry.create({
      data: {
        id: randomUUID(),
        tenantId,
        skuId: input.skuId,
        warehouseId: input.warehouseId,
        locationId: fgStock.locationId,
        batchId: fgStock.batchId,
        eventType: 'KIT_DISASSEMBLY_CONSUME',
        quantityDelta: -qty,
        quantityAfter: newFgOnHand,
        unitCost: finishedSku.cost,
        referenceId: bom.id,
        referenceType: 'BOM_DISASSEMBLY',
        performedBy: userId,
        correlationId,
      },
    })

    // 2. Restore component parts to stock
    const restoredComponents: Array<{ componentSkuId: string; quantityRestored: number }> = []

    for (const item of bom.items) {
      const compQtyPerKit = Number(item.quantity)
      const qtyToRestore = compQtyPerKit * qty
      restoredComponents.push({ componentSkuId: item.componentSkuId, quantityRestored: qtyToRestore })

      let compStock = await tx.stockLevel.findFirst({
        where: {
          tenantId,
          warehouseId: input.warehouseId,
          skuId: item.componentSkuId,
        },
      })

      let newCompOnHand = qtyToRestore
      if (compStock) {
        newCompOnHand = compStock.quantityOnHand + qtyToRestore
        await tx.stockLevel.update({
          where: { id: compStock.id },
          data: {
            quantityOnHand: newCompOnHand,
            quantityAvailable: { increment: qtyToRestore },
          },
        })
      } else {
        compStock = await tx.stockLevel.create({
          data: {
            id: randomUUID(),
            tenantId,
            skuId: item.componentSkuId,
            warehouseId: input.warehouseId,
            batchId: '',
            quantityOnHand: qtyToRestore,
            quantityAvailable: qtyToRestore,
            quantityReserved: 0,
          },
        })
      }

      const compSku = await tx.sKU.findFirst({
        where: { id: item.componentSkuId, tenantId },
      })

      await tx.stockLedgerEntry.create({
        data: {
          id: randomUUID(),
          tenantId,
          skuId: item.componentSkuId,
          warehouseId: input.warehouseId,
          locationId: compStock.locationId,
          batchId: compStock.batchId,
          eventType: 'KIT_DISASSEMBLY_RESTORE',
          quantityDelta: qtyToRestore,
          quantityAfter: newCompOnHand,
          unitCost: compSku?.cost ?? new Prisma.Decimal(0),
          referenceId: bom.id,
          referenceType: 'BOM_DISASSEMBLY',
          performedBy: userId,
          correlationId,
        },
      })
    }

    return {
      success: true,
      quantityDisassembled: qty,
      restoredComponents,
      correlationId,
    }
  })
}
