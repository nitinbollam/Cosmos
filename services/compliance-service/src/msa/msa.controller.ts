import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { MSAEngine } from './msa.engine'
import { PrismaService } from '../prisma/prisma.service'

@Controller('msa')
export class MSAController {
  constructor(
    private engine: MSAEngine,
    private prisma: PrismaService,
  ) {}

  @Post('reports/generate')
  async generate(@Req() req: { user: { tenantId: string } }, @Query('weekOffset') weekOffset?: string) {
    const offset = weekOffset ? parseInt(weekOffset, 10) : 0
    const ids = await this.engine.generateReportForTenant(req.user.tenantId, offset)
    return { reports: ids }
  }

  @Get('reports')
  list(@Req() req: { user: { tenantId: string } }, @Query('status') status?: string) {
    return this.prisma.mSAReport.findMany({
      where: { tenantId: req.user.tenantId, ...(status ? { status: status as 'GENERATED' | 'SUBMITTED' | 'SUBMISSION_FAILED' | 'ACCEPTED' } : {}) },
      orderBy: { weekEnding: 'desc' },
      take: 100,
    })
  }

  @Get('reports/:id')
  get(@Req() req: { user: { tenantId: string } }, @Param('id') id: string) {
    return this.prisma.mSAReport.findFirst({ where: { id, tenantId: req.user.tenantId } })
  }
}
