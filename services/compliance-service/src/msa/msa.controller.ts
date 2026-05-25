import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { MSAEngine } from './msa.engine'
import { PrismaService } from '../prisma/prisma.service'
import { UpsertMsaConfigDto } from './dto/upsert-msa-config.dto'
import { ImportMsaTransactionsDto } from './dto/import-msa-transactions.dto'

@Controller('msa')
export class MSAController {
  constructor(
    private engine: MSAEngine,
    private prisma: PrismaService,
  ) {}

  @Post('run-now')
  runNow(@Req() req: { user: { tenantId: string } }, @Query('weekOffset') weekOffset?: string) {
    return this.generate(req, weekOffset)
  }

  @Post('reports/generate')
  async generate(@Req() req: { user: { tenantId: string } }, @Query('weekOffset') weekOffset?: string) {
    const offset = weekOffset ? parseInt(weekOffset, 10) : 0
    const ids = await this.engine.generateReportForTenant(req.user.tenantId, offset)
    return { reports: ids }
  }

  @Post('transactions/import')
  async importTransactions(
    @Req() req: { user: { tenantId: string } },
    @Body() dto: ImportMsaTransactionsDto,
  ) {
    const tenantId = req.user.tenantId
    let created = 0
    const errors: Array<{ row: number; message: string }> = []
    for (let index = 0; index < dto.rows.length; index++) {
      const row = dto.rows[index]
      const rowNum = index + 2
      try {
        await this.prisma.mSATransaction.create({
          data: {
            tenantId,
            manufacturerDid: row.manufacturerDid,
            upcCode: row.upcCode,
            transactionDate: new Date(row.transactionDate),
            quantityPurchased: row.quantityPurchased,
            cartonCount: row.cartonCount,
            netAmount: row.netAmount,
            returnAmount: row.returnAmount ?? 0,
            isQualifying: row.isQualifying ?? true,
            orderId: row.orderId,
            poId: row.poId,
          },
        })
        created++
      } catch (e) {
        errors.push({
          row: rowNum,
          message: e instanceof Error ? e.message : 'Could not create transaction',
        })
      }
    }
    return { created, failed: errors.length, errors }
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

  @Get('config')
  getConfig(@Req() req: { user: { tenantId: string } }) {
    return this.prisma.mSATenant.findFirst({
      where: { tenantId: req.user.tenantId },
      include: { manufacturerDids: { where: { isActive: true } } },
    })
  }

  @Post('config')
  async upsertConfig(@Req() req: { user: { tenantId: string } }, @Body() dto: UpsertMsaConfigDto) {
    const tenantId = req.user.tenantId
    let row = await this.prisma.mSATenant.findFirst({ where: { tenantId } })
    if (!row) {
      row = await this.prisma.mSATenant.create({
        data: {
          tenantId,
          reporterDid: dto.reporterDid,
          msaEnabled: dto.msaEnabled ?? true,
          manufacturerDids: {
            create: {
              reporterDid: dto.reporterDid,
              manufacturerDid: dto.manufacturerDid,
              manufacturerName: dto.manufacturerName,
              ediEndpoint: dto.ediEndpoint,
              autoSubmit: dto.autoSubmit ?? false,
            },
          },
        },
      })
    } else {
      await this.prisma.mSATenant.update({
        where: { id: row.id },
        data: {
          reporterDid: dto.reporterDid,
          ...(dto.msaEnabled !== undefined ? { msaEnabled: dto.msaEnabled } : {}),
        },
      })
      await this.prisma.mSAManufacturerDid.upsert({
        where: {
          msaTenantId_manufacturerDid: { msaTenantId: row.id, manufacturerDid: dto.manufacturerDid },
        },
        create: {
          msaTenantId: row.id,
          reporterDid: dto.reporterDid,
          manufacturerDid: dto.manufacturerDid,
          manufacturerName: dto.manufacturerName,
          ediEndpoint: dto.ediEndpoint,
          autoSubmit: dto.autoSubmit ?? false,
        },
        update: {
          reporterDid: dto.reporterDid,
          manufacturerName: dto.manufacturerName,
          ediEndpoint: dto.ediEndpoint,
          ...(dto.autoSubmit !== undefined ? { autoSubmit: dto.autoSubmit } : {}),
          isActive: true,
        },
      })
    }
    return this.prisma.mSATenant.findFirst({
      where: { tenantId },
      include: { manufacturerDids: { where: { isActive: true } } },
    })
  }
}
