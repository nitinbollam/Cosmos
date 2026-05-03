import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { CreateFulfillmentTaskDto } from './dto/create-fulfillment-task.dto'
import { randomUUID } from 'crypto'
import { logger } from '@cosmos/logger'
import type { FulfillmentTask, PickLine, FulfillmentTaskStatus } from '../generated/prisma-client'

type FulfillmentTaskWithLines = FulfillmentTask & { pickLines: PickLine[] }

@Injectable()
export class FulfillmentService {
  constructor(
    private prisma: PrismaService,
    private bus: EventBusClient,
  ) {}

  async createTask(tenantId: string, dto: CreateFulfillmentTaskDto) {
    const existing = await this.prisma.fulfillmentTask.findUnique({
      where: { tenantId_orderId: { tenantId, orderId: dto.orderId } },
    })
    if (existing && existing.status !== 'CANCELLED') {
      throw new ConflictException(`Fulfillment already exists for order ${dto.orderId}`)
    }
    if (existing?.status === 'CANCELLED') {
      await this.prisma.pickLine.deleteMany({ where: { taskId: existing.id } })
      await this.prisma.fulfillmentTask.delete({ where: { id: existing.id } })
    }

    const first = dto.lineItems[0]
    if (!first) throw new ConflictException('lineItems required')

    const warehouseId = first.warehouseId
    const warehouseCode = `WH-${warehouseId.slice(-6).toUpperCase()}`

    const task = await this.prisma.fulfillmentTask.create({
      data: {
        tenantId,
        orderId: dto.orderId,
        priority: dto.priority ?? 'NORMAL',
        correlationId: dto.correlationId,
        warehouseId,
        warehouseCode,
        pickLines: {
          create: dto.lineItems.map((li) => ({
            skuId: li.skuId,
            warehouseId: li.warehouseId,
            quantity: li.quantity,
          })),
        },
      },
      include: { pickLines: true },
    })

    await this.bus.publish({
      id: randomUUID(),
      type: EventType.PICK_LIST_CREATED,
      tenantId,
      timestamp: new Date(),
      correlationId: dto.correlationId,
      version: 1,
      payload: {
        taskId: task.id,
        orderId: task.orderId,
        lineCount: task.pickLines.length,
      },
    })

    logger.info({ tenantId, orderId: dto.orderId, taskId: task.id }, 'fulfillment task created')
    return { taskId: task.id, status: task.status }
  }

  async cancelByOrder(tenantId: string, orderId: string, correlationId: string): Promise<{ cancelled: boolean }> {
    const task = await this.prisma.fulfillmentTask.findUnique({
      where: { tenantId_orderId: { tenantId, orderId } },
    })
    if (!task) {
      logger.warn({ tenantId, orderId }, 'cancel fulfillment: task not found (idempotent)')
      return { cancelled: false }
    }
    if (task.status === 'CANCELLED') return { cancelled: false }

    await this.prisma.fulfillmentTask.update({
      where: { id: task.id },
      data: { status: 'CANCELLED' },
    })

    await this.bus.publish({
      id: randomUUID(),
      type: EventType.PICK_LIST_COMPLETED,
      tenantId,
      timestamp: new Date(),
      correlationId,
      version: 1,
      payload: { taskId: task.id, orderId, outcome: 'CANCELLED' },
    })

    return { cancelled: true }
  }

  async getTaskForFloor(tenantId: string, taskId: string) {
    const t = await this.prisma.fulfillmentTask.findFirst({
      where: { id: taskId, tenantId },
      include: { pickLines: true },
    })
    if (!t) throw new NotFoundException('Task not found')
    return {
      id: t.id,
      orderId: t.orderId,
      status: t.status,
      priority: t.priority,
      warehouseCode: t.warehouseCode,
      correlationId: t.correlationId,
      warehouseId: t.warehouseId,
      pickItems: t.pickLines.map((p) => ({
        id: p.id,
        skuId: p.skuId,
        warehouseId: p.warehouseId,
        quantity: p.quantity,
        pickedQty: p.pickedQty,
        status: p.status,
      })),
    }
  }

  async listTasksForFloor(tenantId: string, status?: string) {
    const where =
      status && status.length > 0
        ? {
            tenantId,
            status: status as 'PENDING' | 'PICKING' | 'PACKED' | 'DISPATCHED' | 'CANCELLED',
          }
        : { tenantId, status: { in: ['PENDING', 'PICKING'] as FulfillmentTaskStatus[] } }
    const rows = await this.prisma.fulfillmentTask.findMany({
      where,
      include: { pickLines: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
    return rows.map((t) => ({
      id: t.id,
      orderId: t.orderId,
      status: t.status,
      priority: t.priority,
      warehouseCode: t.warehouseCode,
      pickItems: t.pickLines.map((p) => ({
        id: p.id,
        skuId: p.skuId,
        quantity: p.quantity,
        pickedQty: p.pickedQty,
        status: p.status,
      })),
    }))
  }

  /** Offline replay endpoint — applies idempotent mutations from the mobile queue. */
  async replayAction(tenantId: string, action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (action) {
      case 'pick_progress':
        return this.applyPickProgress(tenantId, payload)
      default:
        logger.warn({ action }, 'unknown replay action — acknowledged')
        return { acknowledged: true, action }
    }
  }

  private async applyPickProgress(tenantId: string, payload: Record<string, unknown>) {
    const taskId = String(payload.taskId ?? '')
    const lineId = String(payload.lineId ?? '')
    const pickedQty = Number(payload.pickedQty ?? 0)
    if (!taskId || !lineId) return { ok: false, reason: 'taskId and lineId required' }

    const task = await this.prisma.fulfillmentTask.findFirst({ where: { id: taskId, tenantId } })
    if (!task) throw new NotFoundException('Task not found')

    await this.prisma.pickLine.updateMany({
      where: { id: lineId, taskId },
      data: { pickedQty, status: pickedQty > 0 ? 'PICKED' : 'PENDING' },
    })

    await this.prisma.fulfillmentTask.update({
      where: { id: taskId },
      data: { status: 'PICKING' },
    })

    return { ok: true }
  }

  /** WatermelonDB-compatible pull — returns tasks created/updated since `since` (ms epoch). */
  async pullChanges(tenantId: string, sinceMs: number) {
    const since = new Date(sinceMs || 0)
    const tasks: FulfillmentTaskWithLines[] = await this.prisma.fulfillmentTask.findMany({
      where: { tenantId, updatedAt: { gt: since } },
      include: { pickLines: true },
    })
    const created = tasks.filter((t) => t.createdAt > since)
    const updated = tasks.filter((t) => t.createdAt <= since && t.updatedAt > since)

    return {
      changes: {
        fulfillment_tasks: {
          created: created.map((t) => ({
            id: t.id,
            order_id: t.orderId,
            status: t.status,
            priority: t.priority,
            warehouse_code: t.warehouseCode,
            updated_at: t.updatedAt.toISOString(),
          })),
          updated: updated.map((t) => ({
            id: t.id,
            order_id: t.orderId,
            status: t.status,
            priority: t.priority,
            warehouse_code: t.warehouseCode,
            updated_at: t.updatedAt.toISOString(),
          })),
          deleted: [],
        },
      },
      timestamp: Date.now(),
    }
  }

  async pushChanges(tenantId: string, body: { changes?: Record<string, unknown> }) {
    logger.info({ tenantId, keys: body.changes ? Object.keys(body.changes) : [] }, 'sync push received')
    return { accepted: true }
  }

  /** Move task to PACKED once every pick line is PICKED or SHORT. */
  async markPacked(tenantId: string, taskId: string) {
    const t = await this.prisma.fulfillmentTask.findFirst({
      where: { id: taskId, tenantId },
      include: { pickLines: true },
    })
    if (!t) throw new NotFoundException('Task not found')
    if (t.status === 'CANCELLED' || t.status === 'DISPATCHED') {
      throw new BadRequestException(`Cannot pack task in status ${t.status}`)
    }
    if (t.status === 'PACKED') return { taskId: t.id, orderId: t.orderId, status: t.status }

    const ready = t.pickLines.every((p) => p.status === 'PICKED' || p.status === 'SHORT')
    if (!ready) {
      throw new BadRequestException('All lines must be PICKED or SHORT before packing')
    }

    const updated = await this.prisma.fulfillmentTask.update({
      where: { id: t.id },
      data: { status: 'PACKED' },
    })

    await this.bus.publish({
      id: randomUUID(),
      type: EventType.SHIPMENT_PACKED,
      tenantId,
      timestamp: new Date(),
      correlationId: t.correlationId,
      version: 1,
      payload: { taskId: t.id, orderId: t.orderId },
    })

    logger.info({ tenantId, taskId: t.id }, 'fulfillment marked PACKED')
    return { taskId: updated.id, orderId: t.orderId, status: updated.status }
  }

  /** Final handoff to outbound — PACKED → DISPATCHED. */
  async markDispatched(tenantId: string, taskId: string) {
    const t = await this.prisma.fulfillmentTask.findFirst({
      where: { id: taskId, tenantId },
      include: { pickLines: true },
    })
    if (!t) throw new NotFoundException('Task not found')
    if (t.status !== 'PACKED') {
      throw new BadRequestException('Task must be PACKED before dispatch')
    }

    const updated = await this.prisma.fulfillmentTask.update({
      where: { id: t.id },
      data: { status: 'DISPATCHED' },
    })

    await this.bus.publish({
      id: randomUUID(),
      type: EventType.SHIPMENT_DISPATCHED,
      tenantId,
      timestamp: new Date(),
      correlationId: t.correlationId,
      version: 1,
      payload: { taskId: t.id, orderId: t.orderId },
    })

    await this.bus.publish({
      id: randomUUID(),
      type: EventType.PICK_LIST_COMPLETED,
      tenantId,
      timestamp: new Date(),
      correlationId: t.correlationId,
      version: 1,
      payload: { taskId: t.id, orderId: t.orderId, outcome: 'DISPATCHED' },
    })

    logger.info({ tenantId, taskId: t.id }, 'fulfillment DISPATCHED')
    return { taskId: updated.id, orderId: t.orderId, status: updated.status }
  }
}
