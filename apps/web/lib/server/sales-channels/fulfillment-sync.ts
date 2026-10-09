import { orderDb } from '../db'
import { getChannelOrderMapping } from './core'
import { pushFulfillmentToShopify } from './shopify'

export async function syncChannelFulfillmentForOrder(tenantId: string, orderId: string): Promise<void> {
  const mapping = await getChannelOrderMapping(tenantId, orderId)
  if (!mapping || mapping.connection.type !== 'SHOPIFY') return

  const shipments = await orderDb.orderShipment.findMany({
    where: {
      tenantId,
      orderId,
      status: 'SHIPPED',
      trackingNumber: { not: null },
      carrier: { not: null },
    },
    orderBy: { shipmentNo: 'asc' },
    take: 1,
  })
  const shipment = shipments[0]
  if (!shipment?.carrier?.trim() || !shipment.trackingNumber?.trim()) return

  await pushFulfillmentToShopify(mapping.connection, mapping.externalOrderId, {
    carrier: shipment.carrier,
    trackingNumber: shipment.trackingNumber,
  })
}
