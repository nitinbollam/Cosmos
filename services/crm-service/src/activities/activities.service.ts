import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateActivityDto } from './dto/create-activity.dto'

@Injectable()
export class ActivitiesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, customerId?: string, leadId?: string) {
    return this.prisma.activity.findMany({
      where: {
        tenantId,
        ...(customerId ? { customerId } : {}),
        ...(leadId ? { leadId } : {}),
      },
      orderBy: { occurredAt: 'desc' },
    })
  }

  async create(tenantId: string, dto: CreateActivityDto) {
    if (!dto.customerId && !dto.leadId) {
      throw new BadRequestException('customerId or leadId required')
    }
    if (dto.customerId) {
      const c = await this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId } })
      if (!c) throw new BadRequestException('Invalid customerId')
    }
    if (dto.leadId) {
      const l = await this.prisma.lead.findFirst({ where: { id: dto.leadId, tenantId } })
      if (!l) throw new BadRequestException('Invalid leadId')
    }
    return this.prisma.activity.create({
      data: {
        tenantId,
        type: dto.type,
        subject: dto.subject,
        body: dto.body,
        customerId: dto.customerId,
        leadId: dto.leadId,
      },
    })
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.activity.findFirst({ where: { id, tenantId } })
    if (!row) throw new NotFoundException('Activity not found')
    return row
  }
}
