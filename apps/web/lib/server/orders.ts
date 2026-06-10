import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-order'
import { orderDb } from './db'
import { computeSalesTax } from './compliance-tax'
import { getTenantSalesTaxRate } from './tenant-tax'
import { assertCreditAvailable, releaseCreditUsed } from './credit-limit'
import { ApiError } from './session'
import { runOrderFulfillmentPipeline, cancelOrderWithCompensation } from './order-orchestration'
import { syncInvoiceFromOrder } from './invoices'
import { assertOrderLinePrices } from './pricing'
import * as notifyTriggers from './notification-triggers'

export type CreateOrderInput = {
  customerId: string
  channel: string
  paymentMethod: string
  salesRepId?: string
  priority?: string
  notes?: string
  shippingAddress?: Record<string, unknown>
  lineItems: Array<{
    skuId: string
    warehouseId: string
    quantity: number
    unitPrice: number
    fulfillmentType?: 'STOCK' | 'DROP_SHIP'
    supplierId?: string
    preferredBatchId?: string
  }>
}

export async function createOrder(
  tenantId: string,
  dto: CreateOrderInput,
  opts?: { buyerCustomerId?: string; awaitPipeline?: boolean },
) {
  const subtotal = dto.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0)
  const taxRate = await getTenantSalesTaxRate(tenantId)
  const taxAmount = computeSalesTax(subtotal, taxRate)
  const totalAmount = subtotal + taxAmount
  const correlationId = randomUUID()

  const customerId = opts?.buyerCustomerId ?? dto.customerId
  if (opts?.buyerCustomerId && dto.customerId !== opts.buyerCustomerId) {
    throw new ApiError(403, 'Cannot place orders for another customer')
  }

  await assertOrderLinePrices(tenantId, customerId, dto.lineItems)

  await assertCreditAvailable(tenantId, customerId, totalAmount, dto.paymentMethod)

  const order = await orderDb.order.create({
    data: {
      tenantId,
      customerId,
      channel: dto.channel as never,
      paymentMethod: dto.paymentMethod as never,
      salesRepId: dto.salesRepId,
      priority: (dto.priority ?? 'NORMAL') as never,
      notes: dto.notes,
      shippingAddress: dto.shippingAddress as never,
      taxAmount: new Prisma.Decimal(taxAmount),
      totalAmount: new Prisma.Decimal(totalAmount),
      lineItems: {
        create: dto.lineItems.map((li) => ({
          skuId: li.skuId,
          warehouseId: li.warehouseId,
          quantity: li.quantity,
          unitPrice: new Prisma.Decimal(li.unitPrice),
          fulfillmentType: li.fulfillmentType ?? 'STOCK',
          supplierId: li.supplierId ?? null,
          preferredBatchId: li.preferredBatchId ?? null,
        })),
      },
    },
    include: { lineItems: true },
  })

  if (opts?.awaitPipeline) {
    await runOrderFulfillmentPipeline(order.id, tenantId, correlationId)
  } else {
    void runOrderFulfillmentPipeline(order.id, tenantId, correlationId).catch((err) =>
      console.error(`[orders] fulfillment pipeline failed for order ${order.id}:`, err),
    )
  }
  void notifyTriggers.notifyOrderCreated(tenantId, order.id, customerId, totalAmount).catch(() => undefined)
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
  opts?: { buyerCustomerId?: string },
) {
  const where: Prisma.OrderWhereInput = { tenantId }

  if (opts?.buyerCustomerId) {
    where.customerId = opts.buyerCustomerId
  } else if (filters?.customerId?.trim()) {
    where.customerId = filters.customerId.trim()
  }
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

export async function findOrderById(tenantId: string, id: string, opts?: { buyerCustomerId?: string }) {
  const order = await orderDb.order.findFirst({
    where: { id, tenantId },
    include: { lineItems: true, saga: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (opts?.buyerCustomerId && order.customerId !== opts.buyerCustomerId) {
    throw new ApiError(404, 'Order not found')
  }
  return order
}

export async function confirmOrder(tenantId: string, id: string) {
  return fulfillOrder(tenantId, id)
}

export async function fulfillOrder(tenantId: string, id: string) {
  const order = await findOrderById(tenantId, id)
  if (!['PENDING', 'CONFIRMED', 'BACKORDERED', 'PROCESSING'].includes(order.status)) {
    throw new ApiError(400, `Order cannot be fulfilled from status ${order.status}`)
  }
  const correlationId = order.saga?.correlationId ?? randomUUID()
  await runOrderFulfillmentPipeline(id, tenantId, correlationId)
  return findOrderById(tenantId, id)
}

export async function listShippedOrdersForDispatch(tenantId: string) {
  return orderDb.order.findMany({
    where: { tenantId, status: 'SHIPPED' },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      customerId: true,
      status: true,
      totalAmount: true,
      shippingAddress: true,
      notes: true,
      updatedAt: true,
    },
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

  const updated = await orderDb.order.update({
    where: { id },
    data: { amountPaid: paidSoFar.plus(apply) },
    include: { lineItems: true },
  })

  if (order.paymentMethod === 'NET_TERMS') {
    await releaseCreditUsed(tenantId, order.customerId, Number(apply)).catch(() => undefined)
  }

  await syncInvoiceFromOrder(tenantId, id).catch(() => undefined)

  const invoice = await orderDb.invoice.findFirst({ where: { tenantId, orderId: id } })
  if (invoice) {
    const { postArPaymentJournal } = await import('./operations-gl')
    await postArPaymentJournal(tenantId, invoice.id, Number(apply)).catch(() => undefined)
    const { notifyPaymentReceived } = await import('./notification-triggers')
    void notifyPaymentReceived(tenantId, id, order.customerId, Number(apply), invoice.invoiceNumber).catch(
      () => undefined,
    )
  }

  return updated
}

export async function cancelOrder(tenantId: string, id: string, reason: string) {
  return cancelOrderWithCompensation(tenantId, id, reason)
}

export async function getReorderLines(tenantId: string, orderId: string, opts?: { buyerCustomerId?: string }) {
  const order = await findOrderById(tenantId, orderId, opts)
  const { resolvePricesForCustomer } = await import('./pricing')
  const skuIds = order.lineItems.map((li) => li.skuId)
  const prices = await resolvePricesForCustomer(tenantId, order.customerId, skuIds)
  const skus = await import('./inventory').then((m) =>
    Promise.all(skuIds.map((id) => m.findSkuById(tenantId, id).catch(() => null))),
  )
  const skuMap = new Map(skus.filter(Boolean).map((s) => [s!.id, s!]))

  return order.lineItems.map((li) => {
    const sku = skuMap.get(li.skuId)
    const resolved = prices.get(li.skuId)
    const unitPrice = resolved?.unitPrice ?? Number(li.unitPrice)
    return {
      skuId: li.skuId,
      skuCode: sku?.code ?? li.skuId.slice(0, 12),
      skuName: sku?.name ?? li.skuId.slice(0, 12),
      warehouseId: li.warehouseId,
      quantity: li.quantity,
      unitPrice,
      listPrice: sku ? Number(sku.price) : Number(li.unitPrice),
      priceSource: resolved?.source ?? 'list',
    }
  })
}
