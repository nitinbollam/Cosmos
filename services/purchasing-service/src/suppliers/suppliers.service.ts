import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateSupplierDto } from './dto/create-supplier.dto'
import { UpdateSupplierDto } from './dto/update-supplier.dto'

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.supplier.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
    })
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.supplier.findFirst({ where: { id, tenantId } })
    if (!row) throw new NotFoundException('Supplier not found')
    return row
  }

  async create(tenantId: string, dto: CreateSupplierDto) {
    try {
      return await this.prisma.supplier.create({
        data: {
          tenantId,
          code: dto.code,
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Supplier code already exists')
      }
      throw e
    }
  }

  async update(tenantId: string, id: string, dto: UpdateSupplierDto) {
    await this.get(tenantId, id)
    return this.prisma.supplier.update({
      where: { id },
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
      },
    })
  }
}
