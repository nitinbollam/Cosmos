import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateChartAccountDto } from './dto/create-account.dto'
import { PatchChartAccountDto } from './dto/patch-account.dto'

@Injectable()
export class ChartAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.chartAccount.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
    })
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.chartAccount.findFirst({ where: { id, tenantId } })
    if (!row) throw new NotFoundException('Account not found')
    return row
  }

  async create(tenantId: string, dto: CreateChartAccountDto) {
    try {
      return await this.prisma.chartAccount.create({
        data: {
          tenantId,
          code: dto.code,
          name: dto.name,
          type: dto.type,
          isActive: dto.isActive ?? true,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Account code already exists')
      }
      throw e
    }
  }

  async patch(tenantId: string, id: string, dto: PatchChartAccountDto) {
    await this.get(tenantId, id)
    return this.prisma.chartAccount.update({
      where: { id },
      data: { name: dto.name, isActive: dto.isActive },
    })
  }
}
