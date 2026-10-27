import { crmDb, dispatchDb, inventoryDb, orderDb } from './db'
import { ApiError } from './session'
import { getRoute, getRouteDetail } from './dispatch'
import { orderIdFromStopAddress } from './dispatch-order'
import { getTenantWorkflowSettings } from './tenant-workflow-settings'
import { needsManager } from './door-adjustment'
import { resolveUnitPrice } from './pricing'
import {
  collectsMoneyOnTheRoad,
  isVanSalePaymentMethod,
  podWithVanSale,
  vanLinesProblem,
  vanSaleRefusal,
  type VanLine,
} from './van-rules'

/**
 * The customer agrees to buy extra from the driver's van (PLR-167). It is a new order for the same
 * customer, shipped at once from the van, so the order the customer already signed for and its
 * invoice are left alone. The sequence is the one the POS counter sale uses: reserve from the van,
 * ship, invoice, mark paid when cash or a cheque is taken. Tax, credit limit and age checks run in
 * the normal order path.
 */
export async function sellFromVan(
  tenantId: string,
  routeId: string,
  stopId: string,
  body: { lines?: unknown; paymentMethod?: unknown },
  actor: { userId: string; role: string },
) {
  const problem = vanLinesProblem(body.lines)
  if (problem) throw new ApiError(400, problem)
  const lines = (body.lines as VanLine[]).map((l) => ({ skuId: l.skuId, quantity: l.quantity }))
  if (!isVanSalePaymentMethod(body.paymentMethod)) {
    throw new ApiError(400, 'Payment must be on account (NET_TERMS), cash or check')
  }
  const paymentMethod = body.paymentMethod

  const route = await getRoute(tenantId, routeId)
  if (!route.driverId) throw new ApiError(409, 'This route has no driver')
  const stop = route.stops.find((s) => s.id === stopId)
  if (!stop) throw new ApiError(404, 'Stop not found')
  if (stop.status === 'DELIVERED' || stop.status === 'FAILED') {
    throw new ApiError(409, 'This stop already has an outcome; sell before completing it')
  }
  const baseOrderId = orderIdFromStopAddress(stop.address)
  if (!baseOrderId)
    throw new ApiError(400, 'This stop has no order, so there is no customer to sell to')
  const baseOrder = await orderDb.order.findFirst({ where: { id: baseOrderId, tenantId } })
  if (!baseOrder) throw new ApiError(404, 'Order not found')

  const van = await inventoryDb.warehouse.findFirst({
    where: { tenantId, kind: 'VEHICLE', assignedDriverId: route.driverId, isActive: true },
  })
  if (!van) throw new ApiError(409, 'The driver on this route has no van')
  const customer = await crmDb.customer.findFirst({ where: { id: baseOrder.customerId, tenantId } })
  if (!customer) throw new ApiError(404, 'Customer not found')

  const refusal = vanSaleRefusal({
    van,
    driverId: route.driverId,
    customer: { vanSalesApproved: customer.vanSalesApproved, primaryState: customer.primaryState },
  })
  if (refusal) throw new ApiError(refusal.code === 'NOT_YOUR_VAN' ? 403 : 409, refusal.message)

  // The customer's own catalog price, never a number the driver types in.
  const priced: Array<{ skuId: string; quantity: number; unitPrice: number }> = []
  for (const l of lines)
    priced.push({ ...l, unitPrice: await resolveUnitPrice(tenantId, customer.id, l.skuId) })
  const cents = priced.reduce((sum, l) => sum + Math.round(l.unitPrice * 100) * l.quantity, 0)

  const { vanSaleThreshold } = await getTenantWorkflowSettings(tenantId)
  if (needsManager(actor.role, cents, vanSaleThreshold)) {
    throw new ApiError(403, 'This sale is above the limit for drivers. A manager needs to make it')
  }

  // Know before creating anything whether the van has the units; the reservation below is the authority.
  const onVan = await inventoryDb.stockLevel.findMany({
    where: { tenantId, warehouseId: van.id, skuId: { in: lines.map((l) => l.skuId) } },
  })
  for (const l of lines) {
    const have = onVan
      .filter((x) => x.skuId === l.skuId)
      .reduce((s, x) => s + x.quantityAvailable, 0)
    if (have < l.quantity)
      throw new ApiError(409, 'The van does not have enough of one of those items')
  }

  const orders = await import('./orders')
  const order = await orders.createOrder(
    tenantId,
    {
      customerId: customer.id,
      channel: 'SALES_REP',
      paymentMethod,
      lineItems: priced.map((l) => ({ ...l, warehouseId: van.id })),
      notes: `Van sale from ${van.code} at stop ${stop.id} (order ${baseOrderId})`,
      shippingAddress: (stop.address ?? undefined) as Record<string, unknown> | undefined,
    },
    { awaitPipeline: true, userId: actor.userId },
  )
  const created = await orderDb.order.findFirst({
    where: { id: order.id, tenantId },
    include: { lineItems: true },
  })
  if (!created) throw new ApiError(500, 'Order not found after creation')

  const { cancelOrderWithCompensation } = await import('./order-orchestration')
  if (created.status === 'AWAITING_APPROVAL') {
    await cancelOrderWithCompensation(
      tenantId,
      order.id,
      'Van sale cancelled: over the credit limit',
    )
    throw new ApiError(
      409,
      "This sale is over the customer's credit limit. Ask a manager, or take cash",
    )
  }
  if (created.lineItems.some((li) => li.quantityBackordered > 0)) {
    await cancelOrderWithCompensation(
      tenantId,
      order.id,
      'Van sale cancelled: not enough on the van',
    )
    throw new ApiError(409, 'The van does not have enough of one of those items')
  }

  const { withOrderFulfillmentLock } = await import('./order-orchestration')
  return withOrderFulfillmentLock(tenantId, order.id, async () => {
  const total = Number(created.totalAmount)
  if (collectsMoneyOnTheRoad(paymentMethod)) {
    // The order's own exact total, so the paid amount equals it to the cent.
    await orderDb.order.update({
      where: { id: order.id },
      data: { amountPaid: created.totalAmount, confirmedAt: new Date() },
    })
  }

  const wms = await import('./wms-fulfillment')
  await wms.cancelFulfillmentByOrder(tenantId, order.id, 'van-immediate')
  const inv = await import('./inventory')
  const serials = await import('./inventory-serials')
  await serials.enforceAndShipSerialsForOrder(
    tenantId,
    order.id,
      created.lineItems.map((li) => ({
        skuId: li.skuId,
        warehouseId: li.warehouseId,
        quantity: li.quantity,
      })),
  )
  const { shipped } = await inv.commitShipmentForOrder(tenantId, order.id, actor.userId)
    const { transitionOrderStatus, onFulfillmentDispatched, onDeliveryStopDelivered } =
      await import('./order-orchestration')
    await transitionOrderStatus(tenantId, order.id, 'PACKED', undefined, { coordinationHeld: true })
  await onFulfillmentDispatched(tenantId, order.id, shipped, undefined, { coordinationHeld: true })
  await onDeliveryStopDelivered(tenantId, order.id)

  const fresh = await dispatchDb.routeStop.findFirst({ where: { id: stopId } })
  await dispatchDb.routeStop.update({
    where: { id: stopId },
    data: {
      pod: podWithVanSale(fresh?.pod, {
        at: new Date().toISOString(),
        by: actor.userId,
        orderId: order.id,
        total: String(created.totalAmount),
        paymentMethod,
        lines,
      }) as never,
    },
  })

    return {
      orderId: order.id,
      total,
      paymentMethod,
      route: await getRouteDetail(tenantId, routeId),
    }
  })
}
