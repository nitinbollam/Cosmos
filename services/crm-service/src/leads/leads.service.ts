import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'
import { ConvertLeadDto } from './dto/convert-lead.dto'
import { CreateLeadDto } from './dto/create-lead.dto'
import { LEAD_KANBAN_STATUSES, PatchLeadDto } from './dto/patch-lead.dto'

const TERMINAL = new Set(['WON', 'LOST'])

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
      data: {
        tenantId,
        companyName: dto.companyName,
        contactName: dto.contactName,
        email: dto.email,
        source: dto.source,
        pipelineValue:
          dto.pipelineValue != null && dto.pipelineValue !== undefined
            ? new Prisma.Decimal(dto.pipelineValue)
            : undefined,
        assignedToUserId: dto.assignedToUserId,
        status: 'NEW',
      },
    })
  }

  async importBulk(
    tenantId: string,
    rows: Array<CreateLeadDto & { status?: (typeof LEAD_KANBAN_STATUSES)[number] }>,
  ) {
    let created = 0
    const errors: Array<{ row: number; message: string }> = []
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      const rowNum = index + 2
      if (!row.companyName?.trim()) {
        errors.push({ row: rowNum, message: 'companyName is required' })
        continue
      }
      if (row.status && !LEAD_KANBAN_STATUSES.includes(row.status)) {
        errors.push({ row: rowNum, message: 'Invalid status' })
        continue
      }
      try {
        await this.prisma.lead.create({
          data: {
            tenantId,
            companyName: row.companyName.trim(),
            contactName: row.contactName,
            email: row.email,
            source: row.source,
            pipelineValue:
              row.pipelineValue != null ? new Prisma.Decimal(row.pipelineValue) : undefined,
            assignedToUserId: row.assignedToUserId,
            status: row.status ?? 'NEW',
          },
        })
        created++
      } catch (e) {
        errors.push({
          row: rowNum,
          message: e instanceof Error ? e.message : 'Could not create lead',
        })
      }
    }
    return { created, failed: errors.length, errors }
  }

  async patch(tenantId: string, id: string, dto: PatchLeadDto) {
    await this.get(tenantId, id)
    const data: Prisma.LeadUpdateInput = {}
    if (dto.status != null) {
      if (!LEAD_KANBAN_STATUSES.includes(dto.status)) {
        throw new BadRequestException('Invalid status')
      }
      data.status = dto.status
    }
    if (dto.companyName != null) data.companyName = dto.companyName
    if (dto.contactName !== undefined) data.contactName = dto.contactName
    if (dto.email !== undefined) data.email = dto.email
    if (dto.source !== undefined) data.source = dto.source
    if (dto.pipelineValue !== undefined) {
      data.pipelineValue =
        dto.pipelineValue == null ? null : new Prisma.Decimal(dto.pipelineValue)
    }
    if (dto.assignedToUserId !== undefined) {
      data.assignedToUserId = dto.assignedToUserId
    }
    if (Object.keys(data).length === 0) {
      return this.get(tenantId, id)
    }
    return this.prisma.lead.update({
      where: { id },
      data,
      include: { customer: true },
    })
  }

  async convert(tenantId: string, id: string, dto: ConvertLeadDto) {
    const lead = await this.get(tenantId, id)
    if (TERMINAL.has(lead.status)) {
      throw new BadRequestException('Cannot convert a closed lead')
    }
    if (lead.customerId) {
      throw new BadRequestException('Lead already linked to a customer')
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
        data: { status: 'WON', customerId: customer.id },
        include: { customer: true },
      })
    })
  }
}
