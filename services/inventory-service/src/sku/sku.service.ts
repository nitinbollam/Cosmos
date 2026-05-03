import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
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
}

@Injectable()
export class SkuService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string, page = 1, pageSize = 50, search?: string) {
    const where: Prisma.SKUWhereInput = {
      tenantId,
      ...(search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }] } : {}),
    }
    const [items, total] = await Promise.all([
      this.prisma.sKU.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { name: 'asc' } }),
      this.prisma.sKU.count({ where }),
    ])
    return { items, total, page, pageSize, hasMore: page * pageSize < total }
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

  /** Match tenant SKU code (case-insensitive) or exact barcode (operators may scan either). */
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
      return await this.prisma.sKU.create({
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
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('SKU code already exists for this tenant')
      }
      throw e
    }
  }
}
