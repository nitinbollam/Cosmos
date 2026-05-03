import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { CreateOrderDto, OrderLineItemDto } from './dto/create-order.dto'
import { Prisma } from '../generated/prisma-client'
import type { OrderLineItem } from '../generated/prisma-client'
import { Decimal } from '../generated/prisma-client/runtime/library'
import { randomUUID } from 'crypto'
import { logger } from '@cosmos/logger'

@Injectable()
export class OrderService {
  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusClient,
  ) {}

  async create(tenantId: string, dto: CreateOrderDto) {
    const totalAmount = dto.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0)
    const correlationId = randomUUID()

    const order = await this.prisma.order.create({
      data: {
        tenantId,
        customerId: dto.customerId,
        channel: dto.channel,
        paymentMethod: dto.paymentMethod,
        salesRepId: dto.salesRepId,
        priority: dto.priority ?? 'NORMAL',
        notes: dto.notes,
        totalAmount: new Decimal(totalAmount),
        lineItems: {
          create: dto.lineItems.map((li: OrderLineItemDto) => ({
            skuId: li.skuId,
            warehouseId: li.warehouseId,
            quantity: li.quantity,
            unitPrice: new Decimal(li.unitPrice),
          })),
        },
      },
      include: { lineItems: true },
    })

    await this.eventBus.publish({
      id: randomUUID(),
      type: EventType.ORDER_CREATED,
      tenantId,
      timestamp: new Date(),
      correlationId,
      version: 1,
      payload: {
        orderId: order.id,
        customerId: order.customerId,
        lineItems: order.lineItems.map((li: OrderLineItem) => ({
          skuId: li.skuId,
          quantity: li.quantity,
          unitPrice: Number(li.unitPrice),
          warehouseId: li.warehouseId,
        })),
        totalAmount: Number(order.totalAmount),
        salesRepId: order.salesRepId ?? undefined,
        channel: order.channel,
      },
    })

    logger.info({ orderId: order.id, tenantId, correlationId }, 'order created')
    return { order, correlationId }
  }

  async list(
    tenantId: string,
    page = 1,
    pageSize = 20,
    filters?: {
      status?: string
      channel?: string
      search?: string
      fromIso?: string
      toIso?: string
      customerId?: string
    },
  ) {
    const where: Prisma.OrderWhereInput = { tenantId }

    if (filters?.customerId?.trim()) {
      where.customerId = filters.customerId.trim()
    }

    if (filters?.channel && filters.channel !== 'ALL') {
      where.channel = filters.channel as Prisma.OrderWhereInput['channel']
    }

    const from = filters?.fromIso ? new Date(filters.fromIso) : null
    const to = filters?.toIso ? new Date(filters.toIso) : null
    if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
      where.createdAt = {}
      if (from && !Number.isNaN(from.getTime())) where.createdAt.gte = from
      if (to && !Number.isNaN(to.getTime())) {
        const end = new Date(to)
        end.setHours(23, 59, 59, 999)
        where.createdAt.lte = end
      }
    }

    if (filters?.search?.trim()) {
      const s = filters.search.trim()
      where.OR = [
        { id: { contains: s, mode: 'insensitive' } },
        { customerId: { contains: s, mode: 'insensitive' } },
      ]
    }

    const st = filters?.status?.trim()
    if (st && st !== 'ALL') {
      if (st === 'FULFILLED') {
        where.status = { in: ['PROCESSING', 'PACKED'] }
      } else {
        where.status = st as Prisma.OrderWhereInput['status']
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { lineItems: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ])
    return { items, total, page, pageSize, hasMore: page * pageSize < total }
  }

  async findById(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: { lineItems: true, saga: true },
    })
    if (!order) throw new NotFoundException('Order not found')
    return order
  }

  async confirm(tenantId: string, id: string) {
    const order = await this.findById(tenantId, id)
    if (order.status !== 'PENDING') {
      throw new BadRequestException(`Order cannot be confirmed from status ${order.status}`)
    }
    return this.prisma.order.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    })
  }

  async cancel(tenantId: string, id: string, reason: string) {
    const order = await this.findById(tenantId, id)
    if (order.status === 'CANCELLED' || order.status === 'DELIVERED') {
      return order
    }
    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), failureReason: reason },
    })
    await this.eventBus.publish({
      id: randomUUID(),
      type: EventType.ORDER_CANCELLED,
      tenantId,
      timestamp: new Date(),
      correlationId: randomUUID(),
      version: 1,
      payload: { orderId: id, reason },
    })
    return updated
  }
}
