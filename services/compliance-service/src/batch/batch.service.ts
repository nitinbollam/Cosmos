import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { randomUUID } from 'crypto'
import { logger } from '@cosmos/logger'

@Injectable()
export class BatchService {
  constructor(
    private prisma: PrismaService,
    private bus: EventBusClient,
  ) {}

  // Daily at 7 AM UTC
  @Cron('0 7 * * *')
  async checkExpiries(): Promise<void> {
    const today = new Date()
    const horizon = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)

    const upcoming = await this.prisma.batch.findMany({
      where: { recalled: false, expiryDate: { gte: today, lte: horizon } },
    })
    for (const b of upcoming) {
      const days = Math.ceil((b.expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
      await this.bus.publish({
        id: randomUUID(),
        type: EventType.BATCH_EXPIRY_ALERT,
        tenantId: b.tenantId,
        timestamp: new Date(),
        correlationId: randomUUID(),
        version: 1,
        payload: {
          batchId: b.id,
          skuId: b.skuId,
          warehouseId: b.warehouseId,
          expiryDate: b.expiryDate,
          daysUntilExpiry: days,
          quantityAtRisk: b.quantity,
        },
      })
    }

    const expired = await this.prisma.batch.findMany({
      where: { recalled: false, expiryDate: { lt: today } },
    })
    for (const b of expired) {
      await this.bus.publish({
        id: randomUUID(),
        type: EventType.BATCH_EXPIRED,
        tenantId: b.tenantId,
        timestamp: new Date(),
        correlationId: randomUUID(),
        version: 1,
        payload: { batchId: b.id, skuId: b.skuId, expiryDate: b.expiryDate },
      })
    }
    logger.info({ upcoming: upcoming.length, expired: expired.length }, 'batch expiry sweep')
  }
}
