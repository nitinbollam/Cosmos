import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { firstValueFrom } from 'rxjs'
import { randomUUID } from 'crypto'
import { EventBusClient, EventType, type ReceivingCompletedPayload } from '@cosmos/event-bus'
import { logger } from '@cosmos/logger'
import { Trace } from '@cosmos/tracing'
import { PrismaService } from '../prisma/prisma.service'
import type { ScanReceivingItemDto } from './dto/scan-receiving-item.dto'
import { ReceivingStatus } from '../generated/prisma-client'

const PO_OPEN_FOR_RECEIVE = new Set(['SUBMITTED', 'PARTIALLY_RECEIVED'])

interface PoLineRow {
  id: string
  skuCode: string | null
  qtyOrdered: number
  qtyReceived: number
  unitCost: string | number | null
}

interface PurchaseOrderResponse {
  id: string
  status: string
  supplierId: string
  lines: PoLineRow[]
}

@Injectable()
export class ReceivingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusClient,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private internalHeaders(tenantId: string): Record<string, string> {
    const secret = this.config.get<string>('INTERNAL_SERVICE_SECRET')
    if (!secret) {
      throw new BadRequestException('INTERNAL_SERVICE_SECRET not configured for WMS')
    }
    return {
      'x-cosmos-internal-key': secret,
      'x-cosmos-tenant-id': tenantId,
      'Content-Type': 'application/json',
    }
  }

  private inventoryBase(): string {
    const b = this.config.get<string>('INVENTORY_SERVICE_URL')?.replace(/\/$/, '')
    if (!b) throw new BadRequestException('INVENTORY_SERVICE_URL not configured')
    return b
  }

  private purchasingBase(): string {
    const b = this.config.get<string>('PURCHASING_SERVICE_URL')?.replace(/\/$/, '')
    if (!b) throw new BadRequestException('PURCHASING_SERVICE_URL not configured')
    return b
  }

  listSessions(tenantId: string, status?: string) {
    const st = status?.trim()
    const allowed = Object.values(ReceivingStatus) as string[]
    const filter =
      st && allowed.includes(st)
        ? { status: st as ReceivingStatus }
        : {}
    return this.prisma.receivingSession.findMany({
      where: {
        tenantId,
        ...filter,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { _count: { select: { items: true } } },
    })
  }

  @Trace()
  async startSession(
    tenantId: string,
    warehouseId: string,
    startedBy: string,
    poId?: string,
    asnId?: string,
  ) {
    if (poId) {
      try {
        const { data: po } = await firstValueFrom(
          this.http.get<PurchaseOrderResponse>(
            `${this.purchasingBase()}/api/v1/purchase-orders/${encodeURIComponent(poId)}`,
            { headers: this.internalHeaders(tenantId) },
          ),
        )
        if (!PO_OPEN_FOR_RECEIVE.has(po.status)) {
          throw new BadRequestException(`PO status ${po.status} — cannot start receiving`)
        }
      } catch (e) {
        if (e instanceof BadRequestException) throw e
        throw new NotFoundException('Purchase order not found or unreachable')
      }
    }

    return this.prisma.receivingSession.create({
      data: {
        tenantId,
        warehouseId,
        poId: poId ?? null,
        asnId: asnId ?? null,
        startedBy,
        status: 'OPEN',
      },
    })
  }

  @Trace()
  async scanItem(
    sessionId: string,
    tenantId: string,
    scannedBy: string,
    dto: ScanReceivingItemDto,
  ) {
    const session = await this.prisma.receivingSession.findFirst({
      where: {
        id: sessionId,
        tenantId,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      },
    })
    if (!session) {
      throw new NotFoundException('Receiving session not found or not open')
    }

    let poLineId: string | null = null
    let poSnapshot: PurchaseOrderResponse | null = null

    const { data: sku } = await firstValueFrom(
      this.http.get<{ id: string; code: string }>(
        `${this.inventoryBase()}/api/v1/skus/lookup/scan-value`,
        {
          params: { value: dto.barcode.trim() },
          headers: this.internalHeaders(tenantId),
        },
      ),
    ).catch(() => {
      throw new NotFoundException(`No SKU found for scan value ${dto.barcode}`)
    })

    if (session.poId) {
      const { data: po } = await firstValueFrom(
        this.http.get<PurchaseOrderResponse>(
          `${this.purchasingBase()}/api/v1/purchase-orders/${encodeURIComponent(session.poId)}`,
          { headers: this.internalHeaders(tenantId) },
        ),
      ).catch(() => {
        throw new NotFoundException('Linked purchase order not found')
      })
      poSnapshot = po
      const line = po.lines.find(
        (l) =>
          l.skuCode &&
          l.skuCode.toLowerCase() === sku.code.toLowerCase() &&
          l.qtyReceived < l.qtyOrdered,
      )
      if (!line) {
        throw new BadRequestException('No open PO line for this SKU on the linked order')
      }
      poLineId = line.id
    }

    const batchKey = dto.batchId?.trim() || null
    const damaged = dto.damagedQty ?? 0

    const existing = await this.prisma.receivingItem.findFirst({
      where: {
        sessionId,
        skuId: sku.id,
        purchaseOrderLineId: poLineId,
        batchId: batchKey,
      },
    })

    const expiry = dto.expiryDate ? new Date(dto.expiryDate) : null

    let item
    if (existing) {
      item = await this.prisma.receivingItem.update({
        where: { id: existing.id },
        data: {
          receivedQty: { increment: dto.receivedQty },
          damagedQty: { increment: damaged },
        },
      })
    } else {
      let expectedQty: number | null = null
      if (poSnapshot && poLineId) {
        const line = poSnapshot.lines.find((l) => l.id === poLineId)
        expectedQty = line ? line.qtyOrdered - line.qtyReceived : null
      }
      item = await this.prisma.receivingItem.create({
        data: {
          sessionId,
          skuId: sku.id,
          purchaseOrderLineId: poLineId,
          barcode: dto.barcode.trim(),
          expectedQty,
          receivedQty: dto.receivedQty,
          damagedQty: damaged,
          batchId: batchKey,
          expiryDate: expiry,
          locationId: dto.locationId?.trim() || null,
          scannedBy,
        },
      })
    }

    if (session.status === 'OPEN') {
      await this.prisma.receivingSession.update({
        where: { id: sessionId },
        data: { status: 'IN_PROGRESS' },
      })
    }

    return item
  }

  @Trace()
  async getSession(sessionId: string, tenantId: string) {
    const session = await this.prisma.receivingSession.findFirst({
      where: { id: sessionId, tenantId },
      include: { items: { orderBy: { scannedAt: 'asc' } } },
    })
    if (!session) throw new NotFoundException('Receiving session not found')
    return session
  }

  @Trace()
  async completeSession(sessionId: string, tenantId: string, notes?: string) {
    const session = await this.prisma.receivingSession.findFirst({
      where: { id: sessionId, tenantId },
      include: { items: true },
    })
    if (!session) throw new NotFoundException('Session not found')
    if (session.status === 'COMPLETED' || session.status === 'CLOSED') {
      throw new BadRequestException('Session already completed')
    }
    if (!session.items.length) {
      throw new BadRequestException('Cannot complete session with no items scanned')
    }

    const hasDiscrepancy = session.items.some((i) => (i.damagedQty ?? 0) > 0)
    const nextStatus = hasDiscrepancy ? 'DISCREPANCY' : 'COMPLETED'
    const correlationId = randomUUID()

    /** Per PO line: total good quantity applied in this session */
    const lineGood = new Map<string, number>()
    for (const it of session.items) {
      const good = it.receivedQty - (it.damagedQty ?? 0)
      if (good <= 0 || !it.purchaseOrderLineId) continue
      lineGood.set(it.purchaseOrderLineId, (lineGood.get(it.purchaseOrderLineId) ?? 0) + good)
    }

    let poMeta: PurchaseOrderResponse | null = null
    if (session.poId) {
      const { data: po } = await firstValueFrom(
        this.http.get<PurchaseOrderResponse>(
          `${this.purchasingBase()}/api/v1/purchase-orders/${encodeURIComponent(session.poId)}`,
          { headers: this.internalHeaders(tenantId) },
        ),
      )
      poMeta = po
    }

    for (const it of session.items) {
      const goodQty = it.receivedQty - (it.damagedQty ?? 0)
      if (goodQty <= 0) continue

      let unitCost = 0
      let supplierId = 'DIRECT'
      if (poMeta && it.purchaseOrderLineId) {
        supplierId = poMeta.supplierId
        const line = poMeta.lines.find((l) => l.id === it.purchaseOrderLineId)
        if (line?.unitCost != null) unitCost = Number(line.unitCost)
      }

      await firstValueFrom(
        this.http.post(
          `${this.inventoryBase()}/api/v1/inventory/receive`,
          {
            skuId: it.skuId,
            warehouseId: session.warehouseId,
            quantity: goodQty,
            unitCost,
            supplierId,
            poId: session.poId ?? undefined,
            batchId: it.batchId ?? undefined,
            locationId: it.locationId ?? undefined,
          },
          { headers: this.internalHeaders(tenantId) },
        ),
      ).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error({ err: msg, sessionId, skuId: it.skuId }, 'inventory receive failed during WMS session')
        throw new BadRequestException(`Inventory receive failed for SKU ${it.skuId}: ${msg}`)
      })
    }

    if (session.poId && lineGood.size > 0) {
      const lines = [...lineGood.entries()].map(([lineId, qtyReceived]) => ({ lineId, qtyReceived }))
      await firstValueFrom(
        this.http.post(
          `${this.purchasingBase()}/api/v1/purchase-orders/${encodeURIComponent(session.poId)}/receive`,
          { lines },
          { headers: this.internalHeaders(tenantId) },
        ),
      ).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error({ err: msg, sessionId, poId: session.poId }, 'PO receive sync failed after inventory')
        throw new BadRequestException(`Could not update purchase order receipt: ${msg}`)
      })
    }

    await this.prisma.receivingSession.update({
      where: { id: sessionId },
      data: {
        status: nextStatus,
        completedAt: new Date(),
        discrepancyNotes: notes?.trim() || null,
      },
    })

    const payload: ReceivingCompletedPayload = {
      sessionId,
      warehouseId: session.warehouseId,
      poId: session.poId,
      itemCount: session.items.length,
      hasDiscrepancy,
    }

    await this.eventBus.publish({
      id: randomUUID(),
      type: EventType.RECEIVING_COMPLETED,
      tenantId,
      timestamp: new Date(),
      correlationId,
      version: 1,
      payload,
    })

    logger.info({ sessionId, tenantId, hasDiscrepancy }, 'Receiving session completed')
    return { sessionId, status: nextStatus, hasDiscrepancy }
  }

  async importItems(
    sessionId: string,
    tenantId: string,
    scannedBy: string,
    rows: Array<{
      barcode: string
      receivedQty: number
      damagedQty?: number
      batchId?: string
      locationId?: string
    }>,
  ) {
    let created = 0
    const errors: Array<{ row: number; message: string }> = []
    for (let index = 0; index < rows.length; index++) {
      try {
        await this.scanItem(sessionId, tenantId, scannedBy, rows[index])
        created++
      } catch (e) {
        errors.push({
          row: index + 2,
          message: e instanceof Error ? e.message : 'Import row failed',
        })
      }
    }
    return { created, failed: errors.length, errors }
  }
}
