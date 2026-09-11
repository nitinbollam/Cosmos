import { randomUUID } from 'node:crypto'
import { Prisma as OrderPrisma } from '@/generated/prisma-order'
import { Prisma, PosTenderMethod } from '@/generated/prisma-tenant'
import { orderDb, tenantDb } from './db'
import * as orders from './orders'
import { ApiError } from './session'
import { assertFeature } from './feature-flags'
import { auditLog } from './audit-log'

export async function listPosRegisters(tenantId: string) {
  return tenantDb.posRegister.findMany({
    where: { tenantId, isActive: true },
    orderBy: { name: 'asc' },
  })
}

export async function createPosRegister(tenantId: string, dto: { name: string; warehouseId?: string }) {
  return tenantDb.posRegister.create({
    data: { tenantId, name: dto.name.trim(), warehouseId: dto.warehouseId },
  })
}

export async function getCurrentShift(tenantId: string, userId: string) {
  return tenantDb.shift.findFirst({
    where: { tenantId, userId, clockOutAt: null },
    orderBy: { clockInAt: 'desc' },
  })
}

export async function clockIn(tenantId: string, userId: string, registerId: string) {
  await assertFeature(tenantId, 'pos')
  const register = await tenantDb.posRegister.findFirst({
    where: { id: registerId, tenantId, isActive: true },
  })
  if (!register) throw new ApiError(404, 'POS register not found')

  const open = await getCurrentShift(tenantId, userId)
  if (open) throw new ApiError(400, 'Already clocked in — clock out first')

  return tenantDb.shift.create({
    data: { tenantId, userId, registerId },
  })
}

export async function clockOut(tenantId: string, userId: string, opts?: { force?: boolean }) {
  const shift = await getCurrentShift(tenantId, userId)
  if (!shift) throw new ApiError(400, 'Not clocked in')

  const openTill = await tenantDb.tillSession.findFirst({
    where: { tenantId, shiftId: shift.id, closedAt: null },
  })
  if (openTill && !opts?.force) {
    throw new ApiError(400, 'Close the till session before clocking out')
  }

  return tenantDb.shift.update({
    where: { id: shift.id },
    data: { clockOutAt: new Date() },
  })
}

export async function getOpenTillSession(tenantId: string, userId: string) {
  const shift = await getCurrentShift(tenantId, userId)
  if (!shift) return null
  return tenantDb.tillSession.findFirst({
    where: { tenantId, shiftId: shift.id, closedAt: null },
    orderBy: { openedAt: 'desc' },
  })
}

export async function openTillSession(
  tenantId: string,
  userId: string,
  registerId: string,
  openingFloat: number,
) {
  if (openingFloat < 0) throw new ApiError(400, 'Opening float must be non-negative')
  const shift = await getCurrentShift(tenantId, userId)
  if (!shift || shift.registerId !== registerId) {
    throw new ApiError(400, 'Clock in on this register before opening a till')
  }
  const existing = await getOpenTillSession(tenantId, userId)
  if (existing) throw new ApiError(400, 'Till session is already open')

  return tenantDb.tillSession.create({
    data: {
      tenantId,
      registerId,
      shiftId: shift.id,
      openedBy: userId,
      openingFloat: new Prisma.Decimal(openingFloat),
    },
  })
}

export async function closeTillSession(
  tenantId: string,
  userId: string,
  sessionId: string,
  closingCount: number,
) {
  if (closingCount < 0) throw new ApiError(400, 'Closing count must be non-negative')
  const session = await tenantDb.tillSession.findFirst({
    where: { id: sessionId, tenantId, closedAt: null },
  })
  if (!session) throw new ApiError(404, 'Open till session not found')

  const cashAgg = await tenantDb.posTender.aggregate({
    where: {
      tenantId,
      tillSessionId: sessionId,
      method: PosTenderMethod.CASH,
    },
    _sum: { amount: true },
  })
  const cashSales = Number(cashAgg._sum.amount ?? 0)
  const expectedTotal = +(Number(session.openingFloat) + cashSales).toFixed(2)
  const variance = +(closingCount - expectedTotal).toFixed(2)

  return tenantDb.tillSession.update({
    where: { id: sessionId },
    data: {
      closedBy: userId,
      closingCount: new Prisma.Decimal(closingCount),
      expectedTotal: new Prisma.Decimal(expectedTotal),
      variance: new Prisma.Decimal(variance),
      closedAt: new Date(),
    },
  })
}

type PosTenderInput = { method: 'CASH' | 'CARD' | 'CHECK' | 'OTHER'; amount: number }

export async function createPosOrder(
  tenantId: string,
  dto: {
    registerId: string
    customerId: string
    lineItems: Array<{ skuId: string; warehouseId: string; quantity: number; unitPrice: number }>
    paymentMethod?: 'CASH' | 'CARD' | 'CHECK'
    tenders?: PosTenderInput[]
    discountCode?: string
    ageAttestation?: {
      method: 'ID_CHECK' | 'DOB_ENTRY' | 'LICENSE_ON_FILE'
      dateOfBirth?: string
      notes?: string
    } | null
  },
  userId: string,
) {
  await assertFeature(tenantId, 'pos')
  const register = await tenantDb.posRegister.findFirst({
    where: { id: dto.registerId, tenantId, isActive: true },
  })
  if (!register) throw new ApiError(404, 'POS register not found')

  const shift = await getCurrentShift(tenantId, userId)
  if (!shift) throw new ApiError(400, 'Clock in before ringing sales')
  if (shift.registerId !== dto.registerId) {
    throw new ApiError(400, 'Active shift is on a different register')
  }
  const till = await getOpenTillSession(tenantId, userId)
  if (!till) throw new ApiError(400, 'Open a till session before ringing sales')

  if (!dto.lineItems?.length) throw new ApiError(400, 'lineItems required')
  if (!dto.customerId?.trim()) throw new ApiError(400, 'customerId required')

  const tenders: PosTenderInput[] =
    dto.tenders?.length
      ? dto.tenders
      : dto.paymentMethod
        ? [{ method: dto.paymentMethod, amount: 0 }]
        : []
  if (!tenders.length) throw new ApiError(400, 'tenders or paymentMethod required')

  const order = await orders.createOrder(
    tenantId,
    {
      customerId: dto.customerId,
      channel: 'POS',
      paymentMethod: tenders.some((t) => t.method === 'CARD')
        ? 'CARD'
        : tenders.some((t) => t.method === 'CHECK')
          ? 'CHECK'
          : 'CASH',
      lineItems: dto.lineItems,
      notes: `POS register ${register.name}`,
      ageAttestation: dto.ageAttestation ?? null,
      discountCode: dto.discountCode,
    },
    { awaitPipeline: true, userId },
  )

  const created = await orderDb.order.findFirst({
    where: { id: order.id, tenantId },
    include: { lineItems: true },
  })
  if (!created) throw new ApiError(500, 'Order not found after creation')

  const totalAmount = Number(created.totalAmount)
  const taxAmount = Number(created.taxAmount ?? 0)

  const resolvedTenders =
    tenders.length === 1 && tenders[0].amount === 0
      ? [{ ...tenders[0], amount: totalAmount }]
      : tenders

  const resolvedTotal = resolvedTenders.reduce((s, t) => s + t.amount, 0)
  if (Math.abs(resolvedTotal - totalAmount) > 0.02) {
    const { cancelOrderWithCompensation } = await import('./order-orchestration')
    await cancelOrderWithCompensation(tenantId, order.id, 'POS sale cancelled: tender mismatch')
    throw new ApiError(
      400,
      `Tender total $${resolvedTotal.toFixed(2)} does not match order total $${totalAmount.toFixed(2)}`,
    )
  }

  if (created.lineItems.some((li) => li.quantityBackordered > 0)) {
    const { cancelOrderWithCompensation } = await import('./order-orchestration')
    await cancelOrderWithCompensation(tenantId, order.id, 'POS sale cancelled: insufficient stock')
    throw new ApiError(400, 'Insufficient stock for POS sale')
  }

  const cashOrCheck = resolvedTenders.some((t) => t.method === 'CASH' || t.method === 'CHECK')
  if (cashOrCheck && !resolvedTenders.some((t) => t.method === 'CARD')) {
    await orderDb.order.update({
      where: { id: order.id },
      data: { amountPaid: new OrderPrisma.Decimal(totalAmount), confirmedAt: new Date() },
    })
  }

  await tenantDb.posTender.createMany({
    data: resolvedTenders.map((t) => ({
      tenantId,
      orderId: order.id,
      tillSessionId: t.method === 'CASH' ? till.id : null,
      method: t.method as PosTenderMethod,
      amount: new Prisma.Decimal(t.amount),
    })),
  })

  const wms = await import('./wms-fulfillment')
  await wms.cancelFulfillmentByOrder(tenantId, order.id, 'pos-immediate')

  const inv = await import('./inventory')
  const serials = await import('./inventory-serials')
  const shipLines = created.lineItems.map((li) => ({
    skuId: li.skuId,
    warehouseId: li.warehouseId,
    quantity: li.quantity,
  }))
  await serials.enforceAndShipSerialsForOrder(tenantId, order.id, shipLines)
  const { shipped } = await inv.commitShipmentForOrder(tenantId, order.id, userId)

  const { transitionOrderStatus, onFulfillmentDispatched, onDeliveryStopDelivered } = await import(
    './order-orchestration'
  )
  await transitionOrderStatus(tenantId, order.id, 'PACKED')
  await onFulfillmentDispatched(tenantId, order.id, shipped)
  await onDeliveryStopDelivered(tenantId, order.id)

  void auditLog(tenantId, {
    action: 'pos.order_created',
    entityType: 'Order',
    entityId: order.id,
    userId,
    metadata: { registerId: dto.registerId, totalAmount, tenders: resolvedTenders },
  }).catch(() => undefined)

  return { ...order, status: 'DELIVERED', totalAmount, taxAmount, tenders: resolvedTenders }
}

export async function createPosReturn(
  tenantId: string,
  dto: {
    originalOrderId: string
    lines: Array<{ skuId: string; quantity: number }>
    refundMethod: 'CASH' | 'CARD' | 'CHECK' | 'OTHER'
  },
  userId: string,
) {
  await assertFeature(tenantId, 'pos')
  const order = await orderDb.order.findFirst({
    where: { id: dto.originalOrderId, tenantId, channel: 'POS' },
    include: { lineItems: true },
  })
  if (!order) throw new ApiError(404, 'POS order not found')
  if (order.status !== 'DELIVERED' && order.status !== 'RETURNED') {
    throw new ApiError(400, `Returns not allowed from status ${order.status}`)
  }

  const memoLines = dto.lines.map((req) => {
    const line = order.lineItems.find((l) => l.skuId === req.skuId)
    if (!line) throw new ApiError(400, `SKU ${req.skuId} was not on the original sale`)
    const remaining = line.quantity - line.returnedQty
    if (req.quantity <= 0 || req.quantity > remaining) {
      throw new ApiError(400, `Invalid return quantity for SKU ${req.skuId}`)
    }
    return { lineItemId: line.id, quantity: req.quantity }
  })

  const invoices = await import('./invoices')
  const { creditMemo } = await invoices.applyCreditMemo(
    tenantId,
    {
      orderId: order.id,
      reason: `POS return (${dto.refundMethod})`,
      lines: memoLines,
      restock: true,
      refundToCard: dto.refundMethod === 'CARD',
    },
    userId,
  )

  if (dto.refundMethod === 'CASH' || dto.refundMethod === 'CHECK') {
    const refundAmount = Number(creditMemo.totalAmount ?? 0)
    if (refundAmount > 0) {
      await orderDb.order.update({
        where: { id: order.id },
        data: {
          amountPaid: {
            decrement: new OrderPrisma.Decimal(Math.min(refundAmount, Number(order.amountPaid))),
          },
        },
      })
    }
  }

  void auditLog(tenantId, {
    action: 'pos.return',
    entityType: 'Order',
    entityId: order.id,
    userId,
    metadata: { refundMethod: dto.refundMethod, lines: dto.lines },
  }).catch(() => undefined)

  return creditMemo
}
