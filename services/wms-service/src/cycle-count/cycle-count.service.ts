import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { CycleCountType } from '../generated/prisma-client'

@Injectable()
export class CycleCountService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.cycleCount.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { _count: { select: { lines: true } } },
    })
  }

  async create(
    tenantId: string,
    userId: string,
    dto: { warehouseId: string; type: CycleCountType; scheduledFor?: string | null },
  ) {
    const scheduled =
      dto.scheduledFor && dto.scheduledFor.length > 0 ? new Date(dto.scheduledFor) : null
    return this.prisma.cycleCount.create({
      data: {
        tenantId,
        warehouseId: dto.warehouseId,
        type: dto.type,
        status: 'DRAFT',
        scheduledFor: scheduled,
        createdBy: userId,
      },
      include: { lines: true },
    })
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { id: 'asc' } } },
    })
    if (!row) throw new NotFoundException('Cycle count not found')
    return row
  }

  async approve(tenantId: string, id: string) {
    const row = await this.get(tenantId, id)
    if (row.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only counts pending approval can be posted')
    }
    return this.prisma.cycleCount.update({
      where: { id: row.id },
      data: { status: 'COMPLETED' },
      include: { lines: true },
    })
  }

  async submitForApproval(tenantId: string, id: string) {
    const row = await this.get(tenantId, id)
    if (row.status !== 'DRAFT' && row.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Count must be draft or in progress to submit')
    }
    return this.prisma.cycleCount.update({
      where: { id: row.id },
      data: { status: 'PENDING_APPROVAL' },
      include: { lines: true },
    })
  }
}
