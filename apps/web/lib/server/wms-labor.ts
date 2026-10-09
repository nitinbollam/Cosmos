import { randomUUID } from 'node:crypto'
import type { WmsLaborEventType } from '@/generated/prisma-wms'
import { wmsDb } from './db'

export async function recordLaborEvent(
  tenantId: string,
  dto: {
    userId: string
    eventType: WmsLaborEventType
    referenceId: string
    quantity?: number
    warehouseId: string
  },
) {
  return wmsDb.wmsLaborEvent.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId: dto.userId,
      eventType: dto.eventType,
      referenceId: dto.referenceId,
      quantity: dto.quantity ?? 0,
      warehouseId: dto.warehouseId,
    },
  })
}

export async function getLaborMetrics(tenantId: string, warehouseId?: string, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const events = await wmsDb.wmsLaborEvent.findMany({
    where: {
      tenantId,
      createdAt: { gte: since },
      ...(warehouseId ? { warehouseId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  })

  const byUser = new Map<string, { picks: number; receives: number; putaways: number; packs: number }>()
  for (const e of events) {
    const cur = byUser.get(e.userId) ?? { picks: 0, receives: 0, putaways: 0, packs: 0 }
    if (e.eventType === 'PICK') cur.picks += e.quantity
    if (e.eventType === 'RECEIVE_SCAN') cur.receives += e.quantity
    if (e.eventType === 'PUTAWAY') cur.putaways += e.quantity
    if (e.eventType === 'PACK' || e.eventType === 'DISPATCH') cur.packs += e.quantity
    byUser.set(e.userId, cur)
  }

  return {
    since,
    totalEvents: events.length,
    byUser: [...byUser.entries()].map(([userId, metrics]) => ({ userId, ...metrics })),
  }
}
