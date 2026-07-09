import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-order'
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

export async function createPosOrder(
  tenantId: string,
  dto: {
    registerId: string
    customerId: string
    lineItems: Array<{ skuId: string; warehouseId: string; quantity: number; unitPrice: number }>
    paymentMethod: 'CASH' | 'CARD' | 'CHECK'
    ageAttestation?: {
      method: 'ID_CHECK' | 'DOB_ENTRY' | 'LICENSE_ON_FILE'
      dateOfBirth?: string
      notes?: string
    } | null
  },
  userId: string,
) {
  await assertFeature(tenantId, 'pos')
  const register = await tenantDb.posRegister.findFirst({ where: { id: dto.registerId, tenantId, isActive: true } })
  if (!register) throw new ApiError(404, 'POS register not found')

  // Counter sale: reserve synchronously so we can fail fast on missing stock.
  const order = await orders.createOrder(
    tenantId,
    {
      customerId: dto.customerId,
      channel: 'POS',
      paymentMethod: dto.paymentMethod,
      lineItems: dto.lineItems,
      notes: `POS register ${register.name}`,
      ageAttestation: dto.ageAttestation,
    },
    { awaitPipeline: true, userId },
  )

  const created = await orderDb.order.findFirst({
    where: { id: order.id, tenantId },
    include: { lineItems: true },
  })
  if (!created) throw new ApiError(500, 'Order not found after creation')

  // Tax comes from the tenant rate applied inside createOrder — no hardcoded default.
  const totalAmount = Number(created.totalAmount)
  const taxAmount = Number(created.taxAmount ?? 0)

  if (created.lineItems.some((li) => li.quantityBackordered > 0)) {
    const { cancelOrderWithCompensation } = await import('./order-orchestration')
    await cancelOrderWithCompensation(tenantId, order.id, 'POS sale cancelled: insufficient stock')
    throw new ApiError(400, 'Insufficient stock for POS sale')
  }

  if (dto.paymentMethod === 'CASH' || dto.paymentMethod === 'CHECK') {
    await orderDb.order.update({
      where: { id: order.id },
      data: { amountPaid: new Prisma.Decimal(totalAmount), confirmedAt: new Date() },
    })
  }

  // Goods leave with the customer now: cancel the pick task, commit inventory,
  // walk the order to DELIVERED, and invoice the shipped quantities.
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
    metadata: { registerId: dto.registerId, totalAmount },
  }).catch(() => undefined)

  return { ...order, status: 'DELIVERED', totalAmount, taxAmount }
}
