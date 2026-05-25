import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { S3Service } from '../storage/s3.service'
import { logger } from '@cosmos/logger'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'

@Injectable()
export class AlcoholComplianceEngine {
  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
  ) {}

  @Cron('0 7 1 * *')
  async generateMonthlyExciseReport(): Promise<void> {
    logger.info('AlcoholComplianceEngine: generating monthly excise report')
    const lastMonth = subMonths(new Date(), 1)
    const periodStart = startOfMonth(lastMonth)
    const periodEnd = endOfMonth(lastMonth)

    const tenants = await this.prisma.batch.groupBy({
      by: ['tenantId'],
      where: { createdAt: { gte: periodStart, lte: periodEnd } },
    })

    for (const { tenantId } of tenants) {
      const batches = await this.prisma.batch.findMany({
        where: { tenantId, createdAt: { gte: periodStart, lte: periodEnd } },
      })

      const totalUnits = batches.reduce((s, b) => s + b.quantity, 0)
      const report = {
        format: 'COSMOS_TTB_EXCISE_V1',
        tenantId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        generatedAt: new Date().toISOString(),
        totalBatches: batches.length,
        totalUnitsDistributed: totalUnits,
        note: 'Review and file with your TTB permit holder. Cosmos does not submit directly to TTB.',
      }

      const fileName = `alcohol-excise/${tenantId}/${format(periodStart, 'yyyy-MM')}/excise-report.json`
      await this.s3.upload(fileName, Buffer.from(JSON.stringify(report, null, 2)), 'application/json')
      logger.info({ tenantId, fileName }, 'AlcoholEngine: excise report generated')
    }
  }
}
