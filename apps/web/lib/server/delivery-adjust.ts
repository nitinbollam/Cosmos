import { orderDb, dispatchDb } from './db'
import { ApiError } from './session'
import { getRoute, getRouteDetail } from './dispatch'
import { orderIdFromStopAddress } from './dispatch-order'
import { applyCreditMemo } from './invoices'
import { getTenantWorkflowSettings } from './tenant-workflow-settings'
import {
  adjustmentProblem,
  needsManager,
  normalizeAdjustment,
  podWithAdjustment,
  reductionValueCents,
} from './door-adjustment'

/**
 * The customer takes less than was shipped (PLR-166). Each reduction is a credit memo against the
 * shipped order: the invoice, order total, tax, customer credit and any card refund all follow the
 * same path as an office-made return. The units stay on the truck, so stock is not put back here;
 * the end-of-day van return does that (PLR-168). Every change is recorded on the stop with who made
 * it and why.
 */
export async function reduceOrderAtDoor(
  tenantId: string,
  routeId: string,
  stopId: string,
  body: unknown,
  actor: { userId: string; role: string },
) {
  const problem = adjustmentProblem(body)
  if (problem) throw new ApiError(400, problem)
  const input = normalizeAdjustment(body)

  const route = await getRoute(tenantId, routeId)
  const stop = route.stops.find((s) => s.id === stopId)
  if (!stop) throw new ApiError(404, 'Stop not found')
  if (stop.status === 'DELIVERED' || stop.status === 'FAILED') {
    throw new ApiError(409, 'This stop already has an outcome; its order can no longer be changed here')
  }
  const orderId = orderIdFromStopAddress(stop.address)
  if (!orderId) throw new ApiError(400, 'This stop has no order to change')

  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId }, include: { lineItems: true } })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.status !== 'SHIPPED') {
    throw new ApiError(409, `An order that is ${order.status} cannot be changed at the door`)
  }

  const remaining = (id: string) => {
    const li = order.lineItems.find((l) => l.id === id)
    return li ? li.quantity - li.returnedQty : 0
  }
  for (const l of input.lines) {
    if (!order.lineItems.some((li) => li.id === l.lineItemId)) throw new ApiError(400, 'That item is not on this order')
    if (l.quantity > remaining(l.lineItemId)) throw new ApiError(400, 'You cannot take off more than is left on the order')
  }
  const everythingGone = order.lineItems.every((li) => {
    const taken = input.lines.find((l) => l.lineItemId === li.id)?.quantity ?? 0
    return li.quantity - li.returnedQty - taken <= 0
  })
  if (everythingGone) {
    throw new ApiError(409, 'Every item is being refused. Mark the stop failed with a reason instead')
  }

  const cents = reductionValueCents(
    input.lines,
    order.lineItems.map((li) => ({ id: li.id, unitPrice: li.unitPrice })),
  )
  const { doorAdjustmentThreshold } = await getTenantWorkflowSettings(tenantId)
  if (needsManager(actor.role, cents, doorAdjustmentThreshold)) {
    throw new ApiError(403, 'This change is above the limit for drivers. A manager needs to make it')
  }

  const { creditMemo } = await applyCreditMemo(
    tenantId,
    { orderId, reason: `Changed at the door: ${input.reason}`, lines: input.lines, restock: false },
    actor.userId,
  )

  const fresh = await dispatchDb.routeStop.findFirst({ where: { id: stopId } })
  await dispatchDb.routeStop.update({
    where: { id: stopId },
    data: {
      pod: podWithAdjustment(fresh?.pod, {
        at: new Date().toISOString(),
        by: actor.userId,
        reason: input.reason,
        memoId: creditMemo.id,
        memoNumber: creditMemo.memoNumber,
        total: String(creditMemo.totalAmount),
        lines: input.lines,
      }) as never,
    },
  })

  return { creditMemo, route: await getRouteDetail(tenantId, routeId) }
}
