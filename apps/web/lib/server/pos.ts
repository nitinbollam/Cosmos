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
  },
  userId: string,
) {
  await assertFeature(tenantId, 'pos')
  const register = await tenantDb.posRegister.findFirst({ where: { id: dto.registerId, tenantId, isActive: true } })
  if (!register) throw new ApiError(404, 'POS register not found')

  const subtotal = dto.lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const { computeSalesTax } = await import('./compliance-tax')
  const taxAmount = computeSalesTax(subtotal)
  const totalAmount = +(subtotal + taxAmount).toFixed(2)

  const order = await orders.createOrder(tenantId, {
    customerId: dto.customerId,
    channel: 'POS',
    paymentMethod: dto.paymentMethod,
    lineItems: dto.lineItems,
    notes: `POS register ${register.name}`,
  })

  if (dto.paymentMethod === 'CASH' || dto.paymentMethod === 'CHECK') {
    await orderDb.order.update({
      where: { id: order.id },
      data: { amountPaid: new Prisma.Decimal(totalAmount), status: 'CONFIRMED', confirmedAt: new Date() },
    })
  }

  void auditLog(tenantId, {
    action: 'pos.order_created',
    entityType: 'Order',
    entityId: order.id,
    userId,
    metadata: { registerId: dto.registerId, totalAmount },
  }).catch(() => undefined)

  return { ...order, totalAmount, taxAmount }
}
