import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import type { Prisma } from '../generated/prisma-client'
import { S3Service } from '../storage/s3.service'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { createHash, randomUUID } from 'crypto'
import { format, startOfWeek, endOfWeek, subWeeks } from 'date-fns'
import { logger } from '@cosmos/logger'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'

interface MulticatRecord {
  reporterDid: string
  manufacturerDid: string
  weekEnding: string
  upcCode: string
  quantity: number
  cartonCount: number
  netPurchases: number
  returns: number
}

interface ManufacturerDidConfig {
  reporterDid: string
  manufacturerDid: string
  manufacturerName: string
  ediEndpoint?: string | null
  autoSubmit: boolean
  ediCredentials: Prisma.JsonValue
}

@Injectable()
export class MSAEngine {
  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
    private eventBus: EventBusClient,
    private http: HttpService,
  ) {}

  @Cron('0 23 * * 0')
  async generateWeeklyReports(): Promise<void> {
    logger.info('MSA weekly generation started')
    const tenants = await this.prisma.mSATenant.findMany({
      where: { isActive: true, msaEnabled: true },
    })
    for (const tenant of tenants) {
      try {
        await this.generateReportForTenant(tenant.tenantId)
      } catch (error) {
        logger.error(
          { tenantId: tenant.tenantId, err: (error as Error).message },
          'MSA failed for tenant',
        )
      }
    }
  }

  async generateReportForTenant(tenantId: string, weekOffset = 0): Promise<string[]> {
    const targetWeekEnd = endOfWeek(subWeeks(new Date(), weekOffset + 1), { weekStartsOn: 1 })
    const targetWeekStart = startOfWeek(subWeeks(new Date(), weekOffset + 1), { weekStartsOn: 1 })

    const tenantConfig = await this.prisma.mSATenant.findFirst({
      where: { tenantId, isActive: true },
      include: { manufacturerDids: true },
    })
    if (!tenantConfig) throw new Error(`MSA config not found for ${tenantId}`)

    const reports: string[] = []

    for (const didConfig of tenantConfig.manufacturerDids) {
      const reportId = randomUUID()
      const transactions = await this.prisma.mSATransaction.findMany({
        where: {
          tenantId,
          manufacturerDid: didConfig.manufacturerDid,
          transactionDate: { gte: targetWeekStart, lte: targetWeekEnd },
          isQualifying: true,
        },
      })
      if (transactions.length === 0) continue

      const aggregated = new Map<string, MulticatRecord>()

      for (const tx of transactions) {
        const key = `${didConfig.reporterDid}|${tx.upcCode}`
        const existing = aggregated.get(key)
        if (existing) {
          existing.quantity += tx.quantityPurchased
          existing.cartonCount += tx.cartonCount
          existing.netPurchases += Number(tx.netAmount)
          existing.returns += Number(tx.returnAmount)
        } else {
          aggregated.set(key, {
            reporterDid: didConfig.reporterDid,
            manufacturerDid: didConfig.manufacturerDid,
            weekEnding: format(targetWeekEnd, 'yyyyMMdd'),
            upcCode: tx.upcCode,
            quantity: tx.quantityPurchased,
            cartonCount: tx.cartonCount,
            netPurchases: Number(tx.netAmount),
            returns: Number(tx.returnAmount),
          })
        }
      }

      const records = Array.from(aggregated.values())
      const fileContent = this.buildMulticatFile(records, didConfig)
      const fileHash = createHash('sha256').update(fileContent).digest('hex')
      const fileName = `msa/${tenantId}/${didConfig.manufacturerDid}/MULTICAT_${format(targetWeekEnd, 'yyyyMMdd')}_${reportId}.txt`

      await this.s3.uploadText(fileName, fileContent, 'text/plain')

      await this.prisma.mSAReport.create({
        data: {
          id: reportId,
          tenantId,
          reporterDid: didConfig.reporterDid,
          manufacturerDid: didConfig.manufacturerDid,
          weekEnding: targetWeekEnd,
          weekStart: targetWeekStart,
          filePath: fileName,
          fileHash,
          totalTransactions: transactions.length,
          netPurchases: transactions.reduce((s, t) => s + Number(t.netAmount), 0),
          status: 'GENERATED',
        },
      })

      await this.eventBus.publish({
        id: randomUUID(),
        type: EventType.MSA_REPORT_GENERATED,
        tenantId,
        timestamp: new Date(),
        correlationId: reportId,
        version: 1,
        payload: {
          reportId,
          weekEnding: targetWeekEnd,
          manufacturerDid: didConfig.manufacturerDid,
          manufacturerName: didConfig.manufacturerName,
          filePath: fileName,
          totalTransactions: transactions.length,
          netPurchases: transactions.reduce((s, t) => s + Number(t.netAmount), 0),
          fileHash,
        },
      })

      if (didConfig.ediEndpoint && didConfig.autoSubmit) {
        await this.submitToManufacturer(
          reportId,
          tenantId,
          didConfig.ediEndpoint,
          fileContent,
          (didConfig.ediCredentials as { apiKey?: string }) ?? {},
        )
      }

      reports.push(reportId)
      logger.info({ tenantId, manufacturerDid: didConfig.manufacturerDid, reportId }, 'MSA report generated')
    }

    return reports
  }

  private buildMulticatFile(records: MulticatRecord[], didConfig: ManufacturerDidConfig): string {
    const header = `HDR|${didConfig.reporterDid}|${records[0]?.weekEnding ?? ''}|MULTICAT|1.0\n`
    const lines = records.map((r) =>
      [
        'DTL',
        r.reporterDid,
        r.manufacturerDid,
        r.weekEnding,
        r.upcCode.padStart(12, '0'),
        r.quantity.toString().padStart(8, '0'),
        r.cartonCount.toString().padStart(6, '0'),
        r.netPurchases.toFixed(2).padStart(12, '0'),
        r.returns.toFixed(2).padStart(12, '0'),
      ].join('|'),
    )
    const trailer = `TRL|${records.length.toString().padStart(6, '0')}\n`
    return header + lines.join('\n') + '\n' + trailer
  }

  private async submitToManufacturer(
    reportId: string,
    tenantId: string,
    ediEndpoint: string,
    fileContent: string,
    credentials: { apiKey?: string },
  ): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.post(ediEndpoint, fileContent, {
          headers: {
            'Content-Type': 'text/plain',
            ...(credentials.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {}),
          },
          timeout: 30_000,
        }),
      )
      const data = (response.data ?? {}) as { confirmationId?: string }
      await this.prisma.mSAReport.update({
        where: { id: reportId },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          submissionConfirmation: data.confirmationId ?? 'ACCEPTED',
        },
      })
      await this.eventBus.publish({
        id: randomUUID(),
        type: EventType.MSA_REPORT_SUBMITTED,
        tenantId,
        timestamp: new Date(),
        correlationId: reportId,
        version: 1,
        payload: { reportId, confirmationId: data.confirmationId ?? 'ACCEPTED' },
      })
    } catch (error) {
      const msg = (error as Error).message
      await this.prisma.mSAReport.update({
        where: { id: reportId },
        data: { status: 'SUBMISSION_FAILED', submissionError: msg },
      })
      await this.eventBus.publish({
        id: randomUUID(),
        type: EventType.MSA_EXCEPTION_RAISED,
        tenantId,
        timestamp: new Date(),
        correlationId: reportId,
        version: 1,
        payload: { reportId, error: msg, requiresManualReview: true },
      })
      logger.error({ reportId, err: msg }, 'MSA submission failed — queued for review')
    }
  }
}
