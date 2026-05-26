import { randomUUID } from 'node:crypto'
import { orderDb } from './db'
import * as inv from './inventory'

/** Reserve inventory for each line — payment/WMS steps stay on legacy proxy until migrated. */
export async function runOrderSaga(orderId: string, tenantId: string, correlationId: string): Promise<void> {
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true },
  })
  if (!order) return

  const sagaId = randomUUID()
  await orderDb.orderSaga.create({
    data: {
      id: sagaId,
      orderId,
      tenantId,
      status: 'RUNNING',
      correlationId,
      completedSteps: [],
      compensations: {},
    },
  })

  const reservationIds: string[] = []

  try {
    for (const item of order.lineItems) {
      const rid = await inv.reserveStock(tenantId, {
        skuId: item.skuId,
        warehouseId: item.warehouseId,
        quantity: item.quantity,
        orderId,
        correlationId,
      })
      reservationIds.push(rid)
    }

    await orderDb.orderSaga.update({
      where: { id: sagaId },
      data: {
        status: 'COMPLETED',
        completedSteps: ['RESERVE_INVENTORY'],
      },
    })

    if (order.status === 'PENDING') {
      await orderDb.order.update({
        where: { id: orderId },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      })
    }
  } catch (err) {
    for (const rid of reservationIds) {
      await inv.releaseReservation(tenantId, rid).catch(() => undefined)
    }
    await orderDb.orderSaga.update({
      where: { id: sagaId },
      data: {
        status: 'FAILED',
        failureReason: err instanceof Error ? err.message : 'Saga failed',
      },
    })
    await orderDb.order.update({
      where: { id: orderId },
      data: { status: 'FAILED', failureReason: err instanceof Error ? err.message : 'Saga failed' },
    })
  }
}
