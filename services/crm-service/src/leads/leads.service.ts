import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { LeadStatus } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'
import { ConvertLeadDto } from './dto/convert-lead.dto'
import { CreateLeadDto } from './dto/create-lead.dto'

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.lead.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { customer: true },
    })
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.lead.findFirst({
      where: { id, tenantId },
      include: { customer: true, activities: true },
    })
    if (!row) throw new NotFoundException('Lead not found')
    return row
  }

  create(tenantId: string, dto: CreateLeadDto) {
    return this.prisma.lead.create({
      data: { tenantId, companyName: dto.companyName, email: dto.email, status: LeadStatus.OPEN },
    })
  }

  async convert(tenantId: string, id: string, dto: ConvertLeadDto) {
    const lead = await this.get(tenantId, id)
    if (lead.status !== LeadStatus.OPEN) {
      throw new BadRequestException('Only OPEN leads can be converted')
    }
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          tenantId,
          name: dto.customerName,
          email: lead.email ?? undefined,
          phone: undefined,
          externalRef: `lead:${lead.id}`,
        },
      })
      return tx.lead.update({
        where: { id },
        data: { status: LeadStatus.CONVERTED, customerId: customer.id },
        include: { customer: true },
      })
    })
  }
}
