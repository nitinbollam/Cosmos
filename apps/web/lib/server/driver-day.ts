import { dispatchDb, inventoryDb, orderDb, tenantDb, authDb } from './db'
import { ApiError } from './session'
import { getRoute, getRouteDetail } from './dispatch'
import { orderIdFromStopAddress } from './dispatch-order'
import { fromCents, toCents } from './money'
import {
  cashVarianceCents,
  collectionProblem,
  collectionsFromPod,
  podCash,
  podWithCollection,
} from './door-collection'
import { dayRange, stockVariance, type CountLine } from './driver-day-rules'

type Actor = { userId: string; role: string }

/**
 * The driver takes cash or a cheque at the door for an order that is paid on delivery. The money is
 * applied to the order (and so its invoice) at once, and recorded on the stop so the day's cash can be
 * reconciled against what the driver hands in.
 */
export async function collectAtDoor(
  tenantId: string,
  routeId: string,
  stopId: string,
  body: { amountCents?: unknown; method?: unknown; reference?: unknown },
  actor: Actor,
) {
  const route = await getRoute(tenantId, routeId)
  const stop = route.stops.find((s) => s.id === stopId)
  if (!stop) throw new ApiError(404, 'Stop not found')
  if (stop.status === 'FAILED') throw new ApiError(409, 'This delivery failed, so nothing is collected on it')
  const orderId = orderIdFromStopAddress(stop.address)
  if (!orderId) throw new ApiError(400, 'This stop has no order to collect against')
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')

  const remainingCents = toCents(order.totalAmount.toString()) - toCents((order.amountPaid ?? 0).toString())
  const problem = collectionProblem(body, remainingCents)
  if (problem) throw new ApiError(400, problem)
  const amountCents = body.amountCents as number
  const method = body.method as 'CASH' | 'CHECK'
  const reference = typeof body.reference === 'string' ? body.reference.trim() : undefined

  const { recordOrderPayment } = await import('./orders')
  await recordOrderPayment(tenantId, orderId, { amount: Number(fromCents(amountCents)), method, reference })

  const fresh = await dispatchDb.routeStop.findFirst({ where: { id: stopId } })
  await dispatchDb.routeStop.update({
    where: { id: stopId },
    data: {
      pod: podWithCollection(fresh?.pod, {
        at: new Date().toISOString(),
        by: actor.userId,
        orderId,
        amount: fromCents(amountCents).toString(),
        method,
        ...(reference ? { reference } : {}),
      }) as never,
    },
  })
  return { orderId, collectedCents: amountCents, route: await getRouteDetail(tenantId, routeId) }
}

export type DriverDayRow = {
  driverId: string
  driverName: string
  stops: number
  delivered: number
  failed: number
  /** Cash and cheques the driver should be holding: van sales plus door collections. */
  expectedCashCents: number
  expectedCheckCents: number
  /** Cash order delivered with a balance and nothing collected. */
  uncollected: Array<{ orderId: string; owedCents: number }>
  returns: Array<{
    id: string
    status: string
    cashExpectedCents: number
    cashCountedCents: number
    cashVarianceCents: number
  }>
  cashVarianceCents: number
  stock: ReturnType<typeof stockVariance>
}

/** One row per driver for one tenant-local day. Read-only; nothing here moves stock or money. */
export async function driverDayReport(tenantId: string, date: string): Promise<{ date: string; drivers: DriverDayRow[] }> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId }, select: { timeZone: true } })
  const range = dayRange(date, org?.timeZone)
  if (!range) throw new ApiError(400, 'date must be a real day as YYYY-MM-DD')
  const { start, endExclusive } = range

  const routes = await dispatchDb.deliveryRoute.findMany({
    where: {
      tenantId,
      driverId: { not: null },
      OR: [
        { scheduledFor: { gte: start, lt: endExclusive } },
        { AND: [{ scheduledFor: null }, { createdAt: { gte: start, lt: endExclusive } }] },
      ],
    },
    include: { stops: true },
  })
  const returns = await inventoryDb.vanReturn.findMany({
    where: { tenantId, createdAt: { gte: start, lt: endExclusive }, driverId: { not: null } },
  })

  const driverIds = [...new Set([...routes.map((r) => r.driverId!), ...returns.map((r) => r.driverId!)])]
  if (driverIds.length === 0) return { date, drivers: [] }
  const users = await authDb.user.findMany({
    where: { tenantId, id: { in: driverIds } },
    select: { id: true, firstName: true, lastName: true },
  })
  const names = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]))

  const orderIds = [
    ...new Set(routes.flatMap((r) => r.stops.map((s) => orderIdFromStopAddress(s.address))).filter((x): x is string => !!x)),
  ]
  const orders = orderIds.length
    ? await orderDb.order.findMany({ where: { tenantId, id: { in: orderIds } }, select: { id: true, paymentMethod: true, totalAmount: true, amountPaid: true } })
    : []
  const orderById = new Map(orders.map((o) => [o.id, o]))

  const drivers: DriverDayRow[] = driverIds.map((driverId) => {
    const mine = routes.filter((r) => r.driverId === driverId)
    const stops = mine.flatMap((r) => r.stops)
    let cash = 0
    let check = 0
    const uncollected: DriverDayRow['uncollected'] = []
    for (const s of stops) {
      const p = podCash(s.pod)
      cash += p.cashCents
      check += p.checkCents
      const oid = orderIdFromStopAddress(s.address)
      const o = oid ? orderById.get(oid) : undefined
      if (s.status === 'DELIVERED' && o && (o.paymentMethod === 'CASH' || o.paymentMethod === 'CHECK') && collectionsFromPod(s.pod).length === 0) {
        const owed = toCents(o.totalAmount.toString()) - toCents((o.amountPaid ?? 0).toString())
        if (owed > 0) uncollected.push({ orderId: o.id, owedCents: owed })
      }
    }
    const rets = returns.filter((r) => r.driverId === driverId)
    const retRows = rets.map((r) => {
      const c = r.cash as { expectedCents: number; countedCents: number }
      return {
        id: r.id,
        status: r.status,
        cashExpectedCents: c.expectedCents,
        cashCountedCents: c.countedCents,
        cashVarianceCents: cashVarianceCents(c.expectedCents, c.countedCents),
      }
    })
    const countLines = rets.flatMap((r) => r.lines as unknown as CountLine[])
    return {
      driverId,
      driverName: names.get(driverId) ?? driverId,
      stops: stops.length,
      delivered: stops.filter((s) => s.status === 'DELIVERED').length,
      failed: stops.filter((s) => s.status === 'FAILED').length,
      expectedCashCents: cash,
      expectedCheckCents: check,
      uncollected,
      returns: retRows,
      cashVarianceCents: retRows.reduce((t, r) => t + r.cashVarianceCents, 0),
      stock: stockVariance(countLines),
    }
  })
  drivers.sort((a, b) => a.driverName.localeCompare(b.driverName))
  return { date, drivers }
}
