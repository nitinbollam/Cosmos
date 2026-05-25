import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { logger } from '@cosmos/logger'
import { randomUUID } from 'crypto'
import { addDays } from 'date-fns'

@Injectable()
export class GeneralComplianceEngine {
  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusClient,
  ) {}

  @Cron('0 8 * * *')
  async checkExpiryAlerts(): Promise<void> {
    logger.info('GeneralComplianceEngine: running expiry check')
    const threshold = addDays(new Date(), 30)
    const expiringSoon = await this.prisma.batch.findMany({
      where: {
        recalled: false,
        expiryDate: { lte: threshold, gte: new Date() },
      },
    })

    for (const batch of expiringSoon) {
      await this.eventBus.publish({
        id: randomUUID(),
        type: EventType.BATCH_EXPIRY_ALERT,
        tenantId: batch.tenantId,
        timestamp: new Date(),
        correlationId: randomUUID(),
        version: 1,
        payload: {
          batchId: batch.id,
          skuId: batch.skuId,
          batchNumber: batch.batchNumber,
          warehouseId: batch.warehouseId,
          expiryDate: batch.expiryDate.toISOString(),
          daysRemaining: Math.ceil((batch.expiryDate.getTime() - Date.now()) / 86400000),
        },
      })
    }

    logger.info({ count: expiringSoon.length }, 'GeneralComplianceEngine: expiry alerts fired')
  }
}
