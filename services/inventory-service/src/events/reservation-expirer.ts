import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { logger } from '@cosmos/logger'

/**
 * Sweeps expired ACTIVE reservations every 60s and releases the held stock.
 * Production should also use a leader-election mechanism (e.g. Redis lock)
 * so multiple replicas don't double-release. Tracked in MISSING.md.
 */
@Injectable()
export class ReservationExpirer implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.sweep().catch((e) => logger.error({ err: (e as Error).message }, 'reservation sweep failed'))
    }, 60_000)
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async sweep() {
    const now = new Date()
    const expired = await this.prisma.stockReservation.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
      take: 100,
    })

    for (const r of expired) {
      await this.prisma.$transaction([
        this.prisma.stockReservation.update({ where: { id: r.id }, data: { status: 'EXPIRED' } }),
        this.prisma.stockLevel.updateMany({
          where: {
            tenantId: r.tenantId,
            skuId: r.skuId,
            warehouseId: r.warehouseId,
            batchId: r.batchId ?? '',
          },
          data: {
            quantityReserved: { decrement: r.quantity },
            quantityAvailable: { increment: r.quantity },
          },
        }),
      ])
      logger.info({ reservationId: r.id }, 'expired reservation released')
    }
  }
}
