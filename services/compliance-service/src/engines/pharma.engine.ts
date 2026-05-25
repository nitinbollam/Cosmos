import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { S3Service } from '../storage/s3.service'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { logger } from '@cosmos/logger'
import { randomUUID } from 'crypto'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'

@Injectable()
export class PharmaComplianceEngine {
  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
    private eventBus: EventBusClient,
  ) {}

  @Cron('0 6 1 * *')
  async generateMonthlyTrackAndTrace(): Promise<void> {
    logger.info('PharmaComplianceEngine: generating monthly lot report')
    const lastMonth = subMonths(new Date(), 1)
    const periodStart = startOfMonth(lastMonth)
    const periodEnd = endOfMonth(lastMonth)

    const tenants = await this.prisma.batch.groupBy({
      by: ['tenantId'],
      where: { createdAt: { gte: periodStart, lte: periodEnd } },
    })

    for (const { tenantId } of tenants) {
      try {
        await this.generateForTenant(tenantId, periodStart, periodEnd)
      } catch (err) {
        logger.error({ tenantId, err: (err as Error).message }, 'PharmaEngine failed for tenant')
      }
    }
  }

  async generateForTenant(tenantId: string, periodStart: Date, periodEnd: Date): Promise<string> {
    const batches = await this.prisma.batch.findMany({
      where: { tenantId, createdAt: { gte: periodStart, lte: periodEnd } },
      orderBy: { createdAt: 'asc' },
    })

    const report = {
      format: 'COSMOS_PHARMA_TRACE_V1',
      tenantId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      totalLots: batches.length,
      lots: batches.map((b) => ({
        lotId: b.id,
        lotNumber: b.batchNumber,
        skuId: b.skuId,
        warehouseId: b.warehouseId,
        quantity: b.quantity,
        manufactureDate: b.manufactureDate?.toISOString() ?? null,
        expiryDate: b.expiryDate.toISOString(),
        recalled: b.recalled,
        recalledAt: b.recalledAt?.toISOString() ?? null,
      })),
    }

    const content = JSON.stringify(report, null, 2)
    const fileName = `pharma-trace/${tenantId}/${format(periodStart, 'yyyy-MM')}/lot-report.json`
    const filePath = await this.s3.upload(fileName, Buffer.from(content), 'application/json')

    await this.eventBus.publish({
      id: randomUUID(),
      type: EventType.MSA_REPORT_GENERATED,
      tenantId,
      timestamp: new Date(),
      correlationId: randomUUID(),
      version: 1,
      payload: { reportType: 'PHARMA_LOT_TRACE', filePath, lotCount: batches.length },
    })

    logger.info({ tenantId, filePath, lots: batches.length }, 'PharmaEngine: report generated')
    return filePath
  }
}
