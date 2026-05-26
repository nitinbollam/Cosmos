import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-order'
import { orderDb } from './db'
import { ApiError } from './session'
import { runOrderSaga } from './order-saga'

export type CreateOrderInput = {
  customerId: string
  channel: string
  paymentMethod: string
  salesRepId?: string
  priority?: string
  notes?: string
  lineItems: Array<{ skuId: string; warehouseId: string; quantity: number; unitPrice: number }>
}

export async function createOrder(tenantId: string, dto: CreateOrderInput) {
  const totalAmount = dto.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0)
  const correlationId = randomUUID()

  const order = await orderDb.order.create({
    data: {
      tenantId,
      customerId: dto.customerId,
      channel: dto.channel as never,
      paymentMethod: dto.paymentMethod as never,
      salesRepId: dto.salesRepId,
      priority: (dto.priority ?? 'NORMAL') as never,
      notes: dto.notes,
      totalAmount: new Prisma.Decimal(totalAmount),
      lineItems: {
        create: dto.lineItems.map((li) => ({
          skuId: li.skuId,
          warehouseId: li.warehouseId,
          quantity: li.quantity,
          unitPrice: new Prisma.Decimal(li.unitPrice),
        })),
      },
    },
    include: { lineItems: true },
  })

  void runOrderSaga(order.id, tenantId, correlationId).catch(() => undefined)
  return order
}

export async function listOrders(
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

  if (filters?.customerId?.trim()) where.customerId = filters.customerId.trim()
  if (filters?.channel && filters.channel !== 'ALL') where.channel = filters.channel as never

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
    where.OR = [{ id: { contains: s } }, { customerId: { contains: s } }]
  }

  const st = filters?.status?.trim()
  if (st && st !== 'ALL') {
    if (st === 'FULFILLED') where.status = { in: ['PROCESSING', 'PACKED'] }
    else where.status = st as never
  }

  const [items, total] = await Promise.all([
    orderDb.order.findMany({
      where,
      include: { lineItems: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    orderDb.order.count({ where }),
  ])
  return { items, total, page, pageSize, hasMore: page * pageSize < total }
}

export async function findOrderById(tenantId: string, id: string) {
  const order = await orderDb.order.findFirst({
    where: { id, tenantId },
    include: { lineItems: true, saga: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  return order
}

export async function confirmOrder(tenantId: string, id: string) {
  const order = await findOrderById(tenantId, id)
  if (order.status !== 'PENDING') {
    throw new ApiError(400, `Order cannot be confirmed from status ${order.status}`)
  }
  return orderDb.order.update({
    where: { id },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  })
}

export async function recordOrderPayment(
  tenantId: string,
  id: string,
  body: { amount: number; method: string; reference?: string },
) {
  const order = await findOrderById(tenantId, id)
  const total = new Prisma.Decimal(order.totalAmount)
  const paidSoFar = new Prisma.Decimal(order.amountPaid ?? 0)
  const remaining = total.minus(paidSoFar)
  const want = new Prisma.Decimal(body.amount)
  if (remaining.lte(0)) throw new ApiError(400, 'Order is already fully paid')
  const apply = Prisma.Decimal.min(want, remaining)
  return orderDb.order.update({
    where: { id },
    data: { amountPaid: paidSoFar.plus(apply) },
    include: { lineItems: true },
  })
}

export async function cancelOrder(tenantId: string, id: string, reason: string) {
  const order = await findOrderById(tenantId, id)
  if (order.status === 'CANCELLED' || order.status === 'DELIVERED') return order
  return orderDb.order.update({
    where: { id },
    data: { status: 'CANCELLED', cancelledAt: new Date(), failureReason: reason },
  })
}
