import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { ReceiveStockDto } from './dto/receive-stock.dto'
import { ReserveStockDto } from './dto/reserve-stock.dto'
import { AdjustStockDto } from './dto/adjust-stock.dto'
import { TransferStockDto } from './dto/transfer-stock.dto'
import { randomUUID } from 'crypto'
import { logger } from '@cosmos/logger'
import { Decimal } from '../generated/prisma-client/runtime/library'

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusClient,
  ) {}

  async receiveStock(tenantId: string, dto: ReceiveStockDto, performedBy: string) {
    const sku = await this.prisma.sKU.findFirst({
      where: { id: dto.skuId, tenantId, isActive: true },
    })
    if (!sku) throw new NotFoundException('SKU not found')

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, tenantId, isActive: true },
    })
    if (!warehouse) throw new NotFoundException('Warehouse not found')

    const correlationId = randomUUID()
    const entryId = randomUUID()
    const batchKey = dto.batchId ?? ''
    const supplierId = dto.supplierId?.trim() || 'INTERNAL'

    const result = await this.prisma.$transaction(async (tx) => {
      const currentLevel = await tx.stockLevel.upsert({
        where: {
          tenantId_skuId_warehouseId_batchId: {
            tenantId,
            skuId: dto.skuId,
            warehouseId: dto.warehouseId,
            batchId: batchKey,
          },
        },
        update: {
          quantityOnHand: { increment: dto.quantity },
          quantityAvailable: { increment: dto.quantity },
        },
        create: {
          id: randomUUID(),
          tenantId,
          skuId: dto.skuId,
          warehouseId: dto.warehouseId,
          locationId: dto.locationId,
          batchId: batchKey,
          quantityOnHand: dto.quantity,
          quantityReserved: 0,
          quantityAvailable: dto.quantity,
        },
      })

      const entry = await tx.stockLedgerEntry.create({
        data: {
          id: entryId,
          tenantId,
          skuId: dto.skuId,
          warehouseId: dto.warehouseId,
          locationId: dto.locationId,
          batchId: batchKey,
          eventType: 'STOCK_RECEIVED',
          quantityDelta: dto.quantity,
          quantityAfter: currentLevel.quantityOnHand,
          unitCost: new Decimal(dto.unitCost),
          referenceId: dto.poId,
          referenceType: dto.poId ? 'PURCHASE_ORDER' : undefined,
          performedBy,
          correlationId,
        },
      })

      return { entry, currentLevel }
    })

    await this.eventBus.publish({
      id: entryId,
      type: EventType.STOCK_RECEIVED,
      tenantId,
      timestamp: new Date(),
      correlationId,
      version: 1,
      payload: {
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        locationId: dto.locationId ?? '',
        batchId: dto.batchId,
        quantity: dto.quantity,
        unitCost: dto.unitCost,
        supplierId,
        poId: dto.poId,
        receivedBy: performedBy,
      },
    })

    await this.checkReorderPoint(tenantId, dto.skuId, dto.warehouseId, correlationId)
    logger.info({ tenantId, skuId: dto.skuId, quantity: dto.quantity }, 'Stock received')
    return result.entry
  }

  async adjustStock(tenantId: string, dto: AdjustStockDto, performedBy: string) {
    const correlationId = randomUUID()
    const entryId = randomUUID()
    const batchKey = dto.batchId ?? ''

    const updated = await this.prisma.$transaction(async (tx) => {
      const level = await tx.stockLevel.findFirst({
        where: { tenantId, skuId: dto.skuId, warehouseId: dto.warehouseId, batchId: batchKey },
      })
      if (!level) throw new NotFoundException('Stock level not found')

      const newOnHand = level.quantityOnHand + dto.quantityDelta
      if (newOnHand < 0) throw new BadRequestException('Adjustment would drive stock negative')

      const updatedLevel = await tx.stockLevel.update({
        where: { id: level.id },
        data: {
          quantityOnHand: newOnHand,
          quantityAvailable: { increment: dto.quantityDelta },
        },
      })

      await tx.stockLedgerEntry.create({
        data: {
          id: entryId,
          tenantId,
          skuId: dto.skuId,
          warehouseId: dto.warehouseId,
          batchId: batchKey,
          eventType: 'STOCK_ADJUSTED',
          quantityDelta: dto.quantityDelta,
          quantityAfter: newOnHand,
          unitCost: new Decimal(0),
          referenceType: 'ADJUSTMENT',
          performedBy,
          correlationId,
        },
      })

      return updatedLevel
    })

    await this.eventBus.publish({
      id: entryId,
      type: EventType.STOCK_ADJUSTED,
      tenantId,
      timestamp: new Date(),
      correlationId,
      version: 1,
      payload: { skuId: dto.skuId, warehouseId: dto.warehouseId, delta: dto.quantityDelta, reason: dto.reason },
    })

    return updated
  }

  async transferStock(tenantId: string, dto: TransferStockDto, performedBy: string) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Source and destination warehouse must differ')
    }
    const batchKey = dto.batchId ?? ''
    const correlationId = randomUUID()

    await this.prisma.$transaction(async (tx) => {
      const from = await tx.stockLevel.findFirst({
        where: { tenantId, skuId: dto.skuId, warehouseId: dto.fromWarehouseId, batchId: batchKey },
      })
      if (!from || from.quantityAvailable < dto.quantity) {
        throw new BadRequestException('Insufficient available stock at source warehouse')
      }

      const fromOnHand = from.quantityOnHand - dto.quantity
      await tx.stockLevel.update({
        where: { id: from.id },
        data: {
          quantityOnHand: fromOnHand,
          quantityAvailable: from.quantityAvailable - dto.quantity,
        },
      })

      await tx.stockLedgerEntry.create({
        data: {
          id: randomUUID(),
          tenantId,
          skuId: dto.skuId,
          warehouseId: dto.fromWarehouseId,
          batchId: batchKey,
          eventType: 'TRANSFER_OUT',
          quantityDelta: -dto.quantity,
          quantityAfter: fromOnHand,
          unitCost: new Decimal(0),
          referenceId: correlationId,
          referenceType: 'TRANSFER',
          performedBy,
          correlationId,
        },
      })

      const toRow = await tx.stockLevel.upsert({
        where: {
          tenantId_skuId_warehouseId_batchId: {
            tenantId,
            skuId: dto.skuId,
            warehouseId: dto.toWarehouseId,
            batchId: batchKey,
          },
        },
        update: {
          quantityOnHand: { increment: dto.quantity },
          quantityAvailable: { increment: dto.quantity },
        },
        create: {
          id: randomUUID(),
          tenantId,
          skuId: dto.skuId,
          warehouseId: dto.toWarehouseId,
          batchId: batchKey,
          quantityOnHand: dto.quantity,
          quantityReserved: 0,
          quantityAvailable: dto.quantity,
        },
      })

      await tx.stockLedgerEntry.create({
        data: {
          id: randomUUID(),
          tenantId,
          skuId: dto.skuId,
          warehouseId: dto.toWarehouseId,
          batchId: batchKey,
          eventType: 'TRANSFER_IN',
          quantityDelta: dto.quantity,
          quantityAfter: toRow.quantityOnHand,
          unitCost: new Decimal(0),
          referenceId: correlationId,
          referenceType: 'TRANSFER',
          performedBy,
          correlationId,
        },
      })
    })

    return { ok: true as const, correlationId }
  }

  async ledgerForSku(tenantId: string, skuId: string, limit = 100) {
    return this.prisma.stockLedgerEntry.findMany({
      where: { tenantId, skuId },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
    })
  }

  async reserveStock(tenantId: string, dto: ReserveStockDto): Promise<string> {
    const batchKey = dto.batchId ?? ''
    const level = await this.prisma.stockLevel.findFirst({
      where: {
        tenantId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        batchId: batchKey,
      },
    })

    if (!level || level.quantityAvailable < dto.quantity) {
      throw new BadRequestException(
        `Insufficient stock: available ${level?.quantityAvailable ?? 0}, requested ${dto.quantity}`,
      )
    }

    const reservationId = randomUUID()

    await this.prisma.$transaction([
      this.prisma.stockLevel.update({
        where: { id: level.id },
        data: {
          quantityReserved: { increment: dto.quantity },
          quantityAvailable: { decrement: dto.quantity },
        },
      }),
      this.prisma.stockReservation.create({
        data: {
          id: reservationId,
          tenantId,
          skuId: dto.skuId,
          warehouseId: dto.warehouseId,
          batchId: batchKey,
          orderId: dto.orderId,
          quantity: dto.quantity,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          status: 'ACTIVE',
        },
      }),
    ])

    await this.eventBus.publish({
      id: randomUUID(),
      type: EventType.STOCK_RESERVED,
      tenantId,
      timestamp: new Date(),
      correlationId: dto.correlationId,
      version: 1,
      payload: {
        reservationId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        orderId: dto.orderId,
      },
    })

    return reservationId
  }

  async releaseReservation(tenantId: string, reservationId: string, correlationId: string): Promise<void> {
    const reservation = await this.prisma.stockReservation.findFirst({
      where: { id: reservationId, tenantId, status: 'ACTIVE' },
    })
    if (!reservation) return

    await this.prisma.$transaction([
      this.prisma.stockReservation.update({
        where: { id: reservationId },
        data: { status: 'RELEASED' },
      }),
      this.prisma.stockLevel.updateMany({
        where: {
          tenantId,
          skuId: reservation.skuId,
          warehouseId: reservation.warehouseId,
          batchId: reservation.batchId ?? '',
        },
        data: {
          quantityReserved: { decrement: reservation.quantity },
          quantityAvailable: { increment: reservation.quantity },
        },
      }),
    ])

    await this.eventBus.publish({
      id: randomUUID(),
      type: EventType.STOCK_RELEASED,
      tenantId,
      timestamp: new Date(),
      correlationId,
      version: 1,
      payload: { reservationId, skuId: reservation.skuId },
    })
  }

  async fulfillReservation(tenantId: string, reservationId: string, correlationId: string): Promise<void> {
    const reservation = await this.prisma.stockReservation.findFirst({
      where: { id: reservationId, tenantId, status: 'ACTIVE' },
    })
    if (!reservation) throw new NotFoundException('Reservation not active')

    await this.prisma.$transaction([
      this.prisma.stockReservation.update({
        where: { id: reservationId },
        data: { status: 'FULFILLED' },
      }),
      this.prisma.stockLevel.updateMany({
        where: {
          tenantId,
          skuId: reservation.skuId,
          warehouseId: reservation.warehouseId,
          batchId: reservation.batchId ?? '',
        },
        data: {
          quantityOnHand: { decrement: reservation.quantity },
          quantityReserved: { decrement: reservation.quantity },
        },
      }),
      this.prisma.stockLedgerEntry.create({
        data: {
          tenantId,
          skuId: reservation.skuId,
          warehouseId: reservation.warehouseId,
          batchId: reservation.batchId,
          eventType: 'RESERVATION_FULFILLED',
          quantityDelta: -reservation.quantity,
          quantityAfter: 0,
          unitCost: new Decimal(0),
          referenceId: reservation.orderId,
          referenceType: 'ORDER',
          performedBy: 'system',
          correlationId,
        },
      }),
    ])
  }

  async lowStockAlerts(tenantId: string) {
    const rows = await this.prisma.stockLevel.findMany({
      where: {
        tenantId,
        reorderPoint: { gt: 0 },
      },
      take: 500,
    })
    const low = rows.filter((r) => r.quantityAvailable <= r.reorderPoint)
    const skuIds = [...new Set(low.map((r) => r.skuId))]
    const skus =
      skuIds.length > 0
        ? await this.prisma.sKU.findMany({
            where: { id: { in: skuIds }, tenantId },
          })
        : []
    const skuName = new Map(skus.map((s) => [s.id, s.name]))
    return {
      lowStock: low.slice(0, 50).map((r) => ({
        skuId: r.skuId,
        name: skuName.get(r.skuId) ?? r.skuId,
        available: r.quantityAvailable,
        reorderPoint: r.reorderPoint,
      })),
    }
  }

  async getStockLevels(tenantId: string, opts: { skuId?: string; warehouseId?: string }) {
    return this.prisma.stockLevel.findMany({
      where: { tenantId, skuId: opts.skuId, warehouseId: opts.warehouseId },
    })
  }

  async patchStockLevel(
    tenantId: string,
    levelId: string,
    patch: { reorderPoint?: number; reorderQty?: number; locationId?: string | null },
  ) {
    const row = await this.prisma.stockLevel.findFirst({ where: { id: levelId, tenantId } })
    if (!row) throw new NotFoundException('Stock level not found')
    return this.prisma.stockLevel.update({
      where: { id: levelId },
      data: {
        ...(patch.reorderPoint !== undefined ? { reorderPoint: patch.reorderPoint } : {}),
        ...(patch.reorderQty !== undefined ? { reorderQty: patch.reorderQty } : {}),
        ...(patch.locationId !== undefined ? { locationId: patch.locationId || null } : {}),
      },
    })
  }

  /** Upsert non-batch (aggregated) stock row for a SKU × warehouse — same as default row on SKU create. */
  async ensureNonBatchStockLevel(
    tenantId: string,
    dto: {
      skuId: string
      warehouseId: string
      locationId?: string
      reorderPoint?: number
      reorderQty?: number
    },
  ) {
    const sku = await this.prisma.sKU.findFirst({ where: { id: dto.skuId, tenantId } })
    if (!sku) throw new NotFoundException('SKU not found')
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, tenantId },
    })
    if (!warehouse) throw new NotFoundException('Warehouse not found')

    return this.prisma.stockLevel.upsert({
      where: {
        tenantId_skuId_warehouseId_batchId: {
          tenantId,
          skuId: dto.skuId,
          warehouseId: dto.warehouseId,
          batchId: '',
        },
      },
      create: {
        id: randomUUID(),
        tenantId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        locationId: dto.locationId !== undefined ? dto.locationId || null : null,
        batchId: '',
        quantityOnHand: 0,
        quantityReserved: 0,
        quantityAvailable: 0,
        reorderPoint: dto.reorderPoint ?? 0,
        reorderQty: dto.reorderQty ?? 0,
      },
      update: {
        ...(dto.reorderPoint !== undefined ? { reorderPoint: dto.reorderPoint } : {}),
        ...(dto.reorderQty !== undefined ? { reorderQty: dto.reorderQty } : {}),
        ...(dto.locationId !== undefined ? { locationId: dto.locationId || null } : {}),
      },
    })
  }

  private async checkReorderPoint(
    tenantId: string,
    skuId: string,
    warehouseId: string,
    correlationId: string,
  ) {
    const level = await this.prisma.stockLevel.findFirst({
      where: { tenantId, skuId, warehouseId },
    })
    if (!level || level.reorderPoint === 0) return
    if (level.quantityAvailable <= level.reorderPoint) {
      await this.eventBus.publish({
        id: randomUUID(),
        type: EventType.STOCK_LEVEL_LOW,
        tenantId,
        timestamp: new Date(),
        correlationId,
        version: 1,
        payload: {
          skuId,
          warehouseId,
          quantityAvailable: level.quantityAvailable,
          reorderPoint: level.reorderPoint,
          suggestedReorderQty: level.reorderQty,
        },
      })
    }
  }
}
