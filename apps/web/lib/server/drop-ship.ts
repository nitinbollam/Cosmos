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
  dto: { carrier?: string; trackingNumber?: string; purchaseOrderId?: string },
) {
  const { withOrderFulfillmentLock } = await import('./order-orchestration')
  return withOrderFulfillmentLock(tenantId, orderId, async (claim) => {
    const order = await orderDb.order.findFirst({
      where: { id: orderId, tenantId },
      include: { lineItems: true },
    })
    await claim.assertOwned()
    if (!order) throw new ApiError(404, 'Order not found')

    let dropLines = order.lineItems.filter(
      (li) =>
        li.fulfillmentType === 'DROP_SHIP' &&
        (!dto.purchaseOrderId || li.dropShipPoId === dto.purchaseOrderId),
    )
    if (dropLines.length === 0) throw new ApiError(400, 'No drop-ship lines on order')

    const carrier = dto.carrier ?? 'DROP_SHIP'
    const trackingNumber = dto.trackingNumber?.trim() || null
    const existingShipments = await orderDb.orderShipment.findMany({
      where: { tenantId, orderId, status: 'SHIPPED' },
      orderBy: { shipmentNo: 'asc' },
      select: { id: true, shipmentNo: true, carrier: true, trackingNumber: true, lineItems: true },
    })
    const ensureShipmentEvent = async (shipment: (typeof existingShipments)[number]) => {
      await claim.assertOwned()
      const items = Array.isArray(shipment.lineItems) ? shipment.lineItems : []
      const { emitOrderEvent } = await import('./domain-events')
      void emitOrderEvent(
        tenantId,
        'order.shipped',
        orderId,
        {
          status: 'SHIPPED',
          shipmentId: shipment.id,
          dropShip: true,
          carrier: shipment.carrier,
          trackingNumber: shipment.trackingNumber,
          shipped: items.flatMap((line) =>
            typeof line === 'object' && line !== null && 'skuId' in line && typeof line.skuId === 'string' &&
            'quantity' in line && typeof line.quantity === 'number'
              ? [{ skuId: line.skuId, quantity: line.quantity }]
              : [],
          ),
        },
        { key: shipment.id },
      )
    }
    const retryBilling = async (shipment: (typeof existingShipments)[number]) => {
      const ids = new Set(
        (Array.isArray(shipment.lineItems) ? shipment.lineItems : []).flatMap((line) =>
          typeof line === 'object' && line !== null && 'lineId' in line && typeof line.lineId === 'string'
            ? [line.lineId]
            : [],
        ),
      )
      const billableLines = dropLines
        .filter((line) => ids.has(line.id))
        .map((line) => ({
          lineId: line.id,
          skuId: line.skuId,
          quantity: Math.max(0, line.quantity - line.quantityInvoiced),
        }))
        .filter((line) => line.quantity > 0)
      if (billableLines.length === 0) return
      const { invoiceShipmentForOrder } = await import('./invoices')
      await invoiceShipmentForOrder(tenantId, orderId, billableLines, undefined, claim).catch((err) =>
        console.error(`[orders] drop-ship invoicing failed for order ${orderId}:`, err),
      )
    }
    const shippedLineIds = new Set<string>()
    for (const shipment of existingShipments) {
      const lines = Array.isArray(shipment.lineItems) ? shipment.lineItems : []
      for (const line of lines) {
        if (typeof line === 'object' && line !== null && 'lineId' in line && typeof line.lineId === 'string') {
          shippedLineIds.add(line.lineId)
        }
      }
    }
    if (trackingNumber) {
      const existing = existingShipments.find((shipment) => {
        if (shipment.carrier !== carrier || shipment.trackingNumber !== trackingNumber) return false
        const shippedLines = Array.isArray(shipment.lineItems) ? shipment.lineItems : []
        if (!dto.purchaseOrderId) {
          const shippedIds = new Set(
            shippedLines.flatMap((line) =>
              typeof line === 'object' && line !== null && 'lineId' in line && typeof line.lineId === 'string'
                ? [line.lineId]
                : [],
            ),
          )
          return dropLines.every((line) => shippedIds.has(line.id))
        }
        return shippedLines.some(
          (line) =>
            typeof line === 'object' &&
            line !== null &&
            'dropShipPoId' in line &&
            line.dropShipPoId === dto.purchaseOrderId,
        )
      })
      if (existing) {
        await ensureShipmentEvent(existing)
        await retryBilling(existing)
        return { orderId, shipmentNo: existing.shipmentNo }
      }
    }

    if (dto.purchaseOrderId) {
      const alreadyShipped = existingShipments.find((shipment) => {
        const shippedLines = Array.isArray(shipment.lineItems) ? shipment.lineItems : []
        const lineIds = new Set(
          shippedLines.flatMap((line) =>
            typeof line === 'object' && line !== null && 'lineId' in line && typeof line.lineId === 'string'
              ? [line.lineId]
              : [],
          ),
        )
        return dropLines.every((line) => lineIds.has(line.id))
      })
      if (alreadyShipped) {
        await ensureShipmentEvent(alreadyShipped)
        await retryBilling(alreadyShipped)
        return { orderId, shipmentNo: alreadyShipped.shipmentNo }
      }
    }
    dropLines = dropLines.filter((line) => !shippedLineIds.has(line.id))
    if (dropLines.length === 0) {
      const latest = existingShipments[existingShipments.length - 1]
      if (latest) {
        if (dto.purchaseOrderId) {
          await ensureShipmentEvent(latest)
          await retryBilling(latest)
        } else for (const shipment of existingShipments) {
          await ensureShipmentEvent(shipment)
          await retryBilling(shipment)
        }
        return { orderId, shipmentNo: latest.shipmentNo }
      }
      throw new ApiError(400, 'No unshipped drop-ship lines on order')
    }

    const shipmentNo = (await orderDb.orderShipment.count({ where: { tenantId, orderId } })) + 1
    const shipmentId = randomUUID()
    await orderDb.$transaction(async (tx) => {
      const owned = await tx.orderSaga.updateMany({
        where: { id: claim.sagaId, status: 'COMPENSATING', correlationId: claim.claimId },
        data: { updatedAt: new Date() },
      })
      if (owned.count !== 1) throw new ApiError(409, 'Order operation lease was taken over')
      await tx.orderShipment.create({
        data: {
          id: shipmentId,
          tenantId,
          orderId,
          shipmentNo,
          status: 'SHIPPED',
          carrier,
          trackingNumber,
          shippedAt: new Date(),
          lineItems: dropLines.map((l) => ({
            lineId: l.id,
            skuId: l.skuId,
            quantity: l.quantity,
            fulfillmentType: 'DROP_SHIP',
            dropShipPoId: l.dropShipPoId,
          })) as OrderPrisma.InputJsonValue,
        },
      })
    })

    await claim.assertOwned()
    await transitionOrderStatus(tenantId, orderId, 'SHIPPED', undefined, {
      coordinationHeld: true,
      ownership: claim,
    })
    await claim.assertOwned()
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
        carrier,
        trackingNumber,
        shipped: dropLines.map((l) => ({ skuId: l.skuId, quantity: l.quantity })),
      },
      { key: shipmentId },
    )

    // Bill exactly the drop-shipped lines (stock lines invoice at their own dispatch).
    const billableLines = dropLines
      .map((line) => ({
        lineId: line.id,
        skuId: line.skuId,
        quantity: Math.max(0, line.quantity - line.quantityInvoiced),
      }))
      .filter((line) => line.quantity > 0)
    if (billableLines.length > 0) {
      const { invoiceShipmentForOrder } = await import('./invoices')
      await invoiceShipmentForOrder(tenantId, orderId, billableLines, undefined, claim).catch((err) =>
        console.error(`[orders] drop-ship invoicing failed for order ${orderId}:`, err),
      )
    }

    if (dto.carrier?.trim() && trackingNumber) {
      void import('./sales-channels/fulfillment-sync')
        .then(({ syncChannelFulfillmentForOrder }) => syncChannelFulfillmentForOrder(tenantId, orderId))
        .catch((err) => console.error(`[sales-channels] fulfillment sync failed for order ${orderId}:`, err))
    }

    return { orderId, shipmentNo }
  }, { allowPackedOrShipped: true })
}
