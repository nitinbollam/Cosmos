import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCustomerDto } from './dto/create-customer.dto'
import { PatchCustomerDto } from './dto/patch-customer.dto'

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.customer.findMany({ where: { tenantId }, orderBy: { name: 'asc' } })
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.customer.findFirst({ where: { id, tenantId } })
    if (!row) throw new NotFoundException('Customer not found')
    return row
  }

  findByExternalRef(tenantId: string, externalRef: string) {
    return this.prisma.customer.findFirst({
      where: { tenantId, externalRef },
    })
  }

  create(tenantId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        tenantId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        externalRef: dto.externalRef,
      },
    })
  }

  async patch(tenantId: string, id: string, dto: PatchCustomerDto) {
    await this.get(tenantId, id)
    return this.prisma.customer.update({
      where: { id },
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        externalRef: dto.externalRef,
      },
    })
  }
}
