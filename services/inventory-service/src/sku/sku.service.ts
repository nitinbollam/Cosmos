import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma } from '../generated/prisma-client'

export interface CreateSkuInput {
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

export interface ListSkusOptions {
  category?: string
  warehouseId?: string
  inStockOnly?: boolean
}

@Injectable()
export class SkuService {
  constructor(private prisma: PrismaService) {}

  async distinctCategories(tenantId: string) {
    const rows = await this.prisma.sKU.groupBy({
      by: ['category'],
      where: { tenantId, isActive: true },
    })
    return rows.map((r) => r.category).sort((a, b) => a.localeCompare(b))
  }

  async list(tenantId: string, page = 1, pageSize = 50, search?: string, opts?: ListSkusOptions) {
    const where: Prisma.SKUWhereInput = {
      tenantId,
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(opts?.category
        ? { category: { equals: opts.category, mode: 'insensitive' as const } }
        : {}),
    }

    if (opts?.inStockOnly) {
      const rows = await this.prisma.stockLevel.findMany({
        where: {
          tenantId,
          quantityAvailable: { gt: 0 },
          ...(opts.warehouseId ? { warehouseId: opts.warehouseId } : {}),
        },
        distinct: ['skuId'],
        select: { skuId: true },
      })
      const idList = [...new Set(rows.map((r) => r.skuId))]
      if (idList.length === 0) {
        return { items: [], total: 0, page, pageSize, hasMore: false }
      }
      where.id = { in: idList }
    }

    const [items, total] = await Promise.all([
      this.prisma.sKU.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.sKU.count({ where }),
    ])

    const skuIds = items.map((i) => i.id)
    if (skuIds.length === 0) {
      return { items: [], total: 0, page, pageSize, hasMore: page * pageSize < total }
    }

    const levels = await this.prisma.stockLevel.findMany({
      where: {
        tenantId,
        skuId: { in: skuIds },
        ...(opts?.warehouseId ? { warehouseId: opts.warehouseId } : {}),
      },
    })

    const agg = new Map<
      string,
      { onHand: number; reserved: number; available: number; reorderPoint: number; reorderQty: number }
    >()
    for (const l of levels) {
      const cur = agg.get(l.skuId) ?? {
        onHand: 0,
        reserved: 0,
        available: 0,
        reorderPoint: 0,
        reorderQty: 0,
      }
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

    return { items: enriched, total, page, pageSize, hasMore: page * pageSize < total }
  }

  async findById(tenantId: string, id: string) {
    const sku = await this.prisma.sKU.findFirst({ where: { id, tenantId } })
    if (!sku) throw new NotFoundException('SKU not found')
    return sku
  }

  async findByCode(tenantId: string, code: string) {
    const sku = await this.prisma.sKU.findFirst({
      where: { tenantId, code: { equals: code.trim(), mode: 'insensitive' } },
    })
    if (!sku) throw new NotFoundException(`SKU code not found: ${code}`)
    return sku
  }

  /** Code or barcode — receiving / warehouse scans. */
  async findByScanValue(tenantId: string, raw: string) {
    const v = raw.trim()
    if (!v) throw new NotFoundException('scan value required')
    const byCode = await this.prisma.sKU.findFirst({
      where: { tenantId, code: { equals: v, mode: 'insensitive' }, isActive: true },
    })
    if (byCode) return byCode
    const byBar = await this.prisma.sKU.findFirst({
      where: { tenantId, barcode: v, isActive: true },
    })
    if (byBar) return byBar
    throw new NotFoundException(`No SKU for scan value: ${v}`)
  }

  async create(tenantId: string, input: CreateSkuInput) {
    try {
      const sku = await this.prisma.sKU.create({
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
        },
      })

      if (input.defaultWarehouseId) {
        await this.prisma.stockLevel.upsert({
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
            ...(input.defaultLocationId !== undefined
              ? { locationId: input.defaultLocationId || null }
              : {}),
          },
        })
      }

      return sku
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('SKU code already exists for this tenant')
      }
      throw e
    }
  }

  async update(tenantId: string, id: string, patch: Partial<CreateSkuInput> & { isActive?: boolean }) {
    await this.findById(tenantId, id)
    try {
      return await this.prisma.sKU.update({
        where: { id },
        data: {
          ...(patch.code !== undefined ? { code: patch.code } : {}),
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.category !== undefined ? { category: patch.category } : {}),
          ...(patch.subcategory !== undefined ? { subcategory: patch.subcategory } : {}),
          ...(patch.barcode !== undefined ? { barcode: patch.barcode } : {}),
          ...(patch.unitOfMeasure !== undefined ? { unitOfMeasure: patch.unitOfMeasure } : {}),
          ...(patch.weightGrams !== undefined
            ? { weightGrams: new Prisma.Decimal(+patch.weightGrams) }
            : {}),
          ...(patch.isTobacco !== undefined ? { isTobacco: patch.isTobacco } : {}),
          ...(patch.isRegulated !== undefined ? { isRegulated: patch.isRegulated } : {}),
          ...(patch.manufacturerId !== undefined ? { manufacturerId: patch.manufacturerId } : {}),
          ...(patch.manufacturerDid !== undefined ? { manufacturerDid: patch.manufacturerDid } : {}),
          ...(patch.exciseTaxCategory !== undefined
            ? { exciseTaxCategory: patch.exciseTaxCategory }
            : {}),
          ...(patch.cost !== undefined ? { cost: new Prisma.Decimal(+patch.cost) } : {}),
          ...(patch.price !== undefined ? { price: new Prisma.Decimal(+patch.price) } : {}),
          ...(patch.minPrice !== undefined
            ? { minPrice: patch.minPrice !== null ? new Prisma.Decimal(+patch.minPrice) : null }
            : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        },
      })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('SKU code already exists for this tenant')
      }
      throw e
    }
  }
}
