import { randomUUID } from 'node:crypto'
import { Prisma as OrderPrisma } from '@/generated/prisma-order'
import { orderDb } from './db'
import * as purchasing from './purchasing'
import { ApiError } from './session'
import { transitionOrderStatus } from './order-orchestration'

export async function createDropShipPurchaseOrders(
  tenantId: string,
  orderId: string,
): Promise<Array<{ lineItemId: string; poId: string }>> {
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')

  const dropLines = order.lineItems.filter((li) => li.fulfillmentType === 'DROP_SHIP')
  if (dropLines.length === 0) return []

  const bySupplier = new Map<string, typeof dropLines>()
  for (const line of dropLines) {
    if (!line.supplierId) throw new ApiError(400, `Drop-ship line ${line.id} missing supplierId`)
    const group = bySupplier.get(line.supplierId) ?? []
    group.push(line)
    bySupplier.set(line.supplierId, group)
  }

  const created: Array<{ lineItemId: string; poId: string }> = []

  for (const [supplierId, lines] of bySupplier) {
    const { findSkuById } = await import('./inventory')
    const poLines = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const sku = await findSkuById(tenantId, line.skuId)
      poLines.push({
        lineNo: i + 1,
        skuCode: sku.code,
        description: sku.name,
        qtyOrdered: line.quantity,
      })
    }

    const po = await purchasing.createPurchaseOrder(tenantId, {
      supplierId,
      number: `DS-${orderId.slice(-8)}-${Date.now().toString(36)}`,
      notes: `Drop-ship for order ${orderId}. Ship to customer.`,
      lines: poLines,
    })
    // Submit immediately — drop-ship POs must be receivable without manual touch.
    await purchasing.submitPurchaseOrder(tenantId, po.id)

    for (const line of lines) {
      await orderDb.orderLineItem.update({
        where: { id: line.id },
        data: { dropShipPoId: po.id, quantityAllocated: line.quantity },
      })
      created.push({ lineItemId: line.id, poId: po.id })
    }
  }

  return created
}

export async function markDropShipLinesShipped(
  tenantId: string,
  orderId: string,
  dto: { carrier?: string; trackingNumber?: string },
) {
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')

  const dropLines = order.lineItems.filter((li) => li.fulfillmentType === 'DROP_SHIP')
  if (dropLines.length === 0) throw new ApiError(400, 'No drop-ship lines on order')

  const shipmentNo =
    (await orderDb.orderShipment.count({ where: { tenantId, orderId } })) + 1

  await orderDb.orderShipment.create({
    data: {
      id: randomUUID(),
      tenantId,
      orderId,
      shipmentNo,
      status: 'SHIPPED',
      carrier: dto.carrier ?? 'DROP_SHIP',
      trackingNumber: dto.trackingNumber ?? null,
      shippedAt: new Date(),
      lineItems: dropLines.map((l) => ({
        skuId: l.skuId,
        quantity: l.quantity,
        fulfillmentType: 'DROP_SHIP',
        dropShipPoId: l.dropShipPoId,
      })) as OrderPrisma.InputJsonValue,
    },
  })

  await transitionOrderStatus(tenantId, orderId, 'SHIPPED')

  // Bill exactly the drop-shipped lines (stock lines invoice at their own dispatch).
  const { invoiceShipmentForOrder } = await import('./invoices')
  await invoiceShipmentForOrder(
    tenantId,
    orderId,
    dropLines.map((l) => ({ skuId: l.skuId, quantity: l.quantity })),
  ).catch((err) => console.error(`[orders] drop-ship invoicing failed for order ${orderId}:`, err))

  if (dto.carrier?.trim() && dto.trackingNumber?.trim()) {
    void import('./sales-channels/fulfillment-sync')
      .then(({ syncChannelFulfillmentForOrder }) => syncChannelFulfillmentForOrder(tenantId, orderId))
      .catch((err) => console.error(`[sales-channels] fulfillment sync failed for order ${orderId}:`, err))
  }

  return { orderId, shipmentNo }
}
