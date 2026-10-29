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
        // A PO line needs a price: it sets the PO total (approval limit) and the value of received stock.
        // A missing or odd product cost becomes 0 rather than refusing the whole drop-ship order.
        unitCost: Math.max(0, Number(sku.cost) || 0),
      })
    }

    // Unresolved approval bypass (no requisition): see createDropShipPurchaseOrder.
    const po = await purchasing.createDropShipPurchaseOrder(tenantId, {
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

  const shipmentId = randomUUID()
  await orderDb.orderShipment.create({
    data: {
      id: shipmentId,
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
  // Drop-shipped by the supplier, so it doesn't pass through warehouse dispatch: one event per shipment.
  const { emitOrderEvent } = await import('./domain-events')
  void emitOrderEvent(
    tenantId,
    'order.shipped',
    orderId,
    {
      status: 'SHIPPED',
      shipmentId,
      dropShip: true,
      carrier: dto.carrier ?? 'DROP_SHIP',
      trackingNumber: dto.trackingNumber ?? null,
      shipped: dropLines.map((l) => ({ skuId: l.skuId, quantity: l.quantity })),
    },
    { key: shipmentId },
  )

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
