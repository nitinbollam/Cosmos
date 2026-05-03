import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export interface CreateWarehouseInput {
  name: string
  code: string
  address: { line1: string; city: string; state: string; postalCode: string; country?: string }
  isDefault?: boolean
}

@Injectable()
export class WarehouseService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.warehouse.findMany({ where: { tenantId } })
  }

  async create(tenantId: string, input: CreateWarehouseInput) {
    try {
      return await this.prisma.warehouse.create({
        data: { tenantId, name: input.name, code: input.code, address: input.address as object, isDefault: input.isDefault ?? false },
      })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('Warehouse code already exists')
      throw e
    }
  }

  async findById(tenantId: string, id: string) {
    const wh = await this.prisma.warehouse.findFirst({ where: { id, tenantId } })
    if (!wh) throw new NotFoundException('Warehouse not found')
    return wh
  }
}
