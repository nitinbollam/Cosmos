import { Prisma } from '@/generated/prisma-analytics'
import { analyticsDb, complianceDb, inventoryDb, orderDb, wmsDb } from './db'
import { ApiError } from './session'

const OPEN_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'PACKED'] as const
const ACTIVE_PICK_STATUSES = ['PENDING', 'PICKING', 'PACKED'] as const
const EXCLUDED_REVENUE_STATUSES = ['CANCELLED', 'FAILED', 'RETURNED'] as const

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function addUtcDays(day: Date, n: number): Date {
  return new Date(day.getTime() + n * 864e5)
}

function pctChange(current: number, prior: number): number {
  if (prior > 0) return ((current - prior) / prior) * 100
  return current > 0 ? 100 : 0
}

/** Roll up one UTC day's orders into the analytics snapshot (keeps charts in sync). */
async function rollupDaySnapshot(tenantId: string, day: Date) {
  const start = utcDayStart(day)
  const end = addUtcDays(start, 1)

  const orders = await orderDb.order.findMany({
    where: {
      tenantId,
      createdAt: { gte: start, lt: end },
      status: { notIn: [...EXCLUDED_REVENUE_STATUSES] },
    },
    select: { totalAmount: true },
  })

  const ordersCount = orders.length
  const revenue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0)
  const skusActive = await inventoryDb.sKU.count({ where: { tenantId, isActive: true } })

  return analyticsDb.dailyKpiSnapshot.upsert({
    where: { tenantId_date: { tenantId, date: start } },
    create: {
      tenantId,
      date: start,
      ordersCount,
      revenue: new Prisma.Decimal(revenue),
      skusActive,
    },
    update: {
      ordersCount,
      revenue: new Prisma.Decimal(revenue),
      skusActive,
    },
  })
}

/** Days of order history rolled into KPI snapshots on dashboard/chart load. */
export const SNAPSHOT_SYNC_DAYS = 30

/** Refresh today's snapshot from live orders so KPI charts stay current. */
export async function syncTodaySnapshotFromOrders(tenantId: string) {
  return rollupDaySnapshot(tenantId, new Date())
}

/** Sync recent daily snapshots from live order totals (includes today). */
export async function syncRecentSnapshotsFromOrders(tenantId: string, days = SNAPSHOT_SYNC_DAYS) {
  const today = utcDayStart(new Date())
  const rows = []
  for (let i = 0; i < days; i++) {
    rows.push(await rollupDaySnapshot(tenantId, addUtcDays(today, -i)))
  }
  return rows
}

async function orderDayMetrics(tenantId: string, day: Date) {
  const start = utcDayStart(day)
  const end = addUtcDays(start, 1)

  const [ordersCount, revenueAgg] = await Promise.all([
    orderDb.order.count({
      where: {
        tenantId,
        createdAt: { gte: start, lt: end },
        status: { notIn: [...EXCLUDED_REVENUE_STATUSES] },
      },
    }),
    orderDb.order.aggregate({
      where: {
        tenantId,
        createdAt: { gte: start, lt: end },
        status: { notIn: [...EXCLUDED_REVENUE_STATUSES] },
      },
      _sum: { totalAmount: true },
    }),
  ])

  return {
    ordersCount,
    revenue: Number(revenueAgg._sum.totalAmount ?? 0),
  }
}

async function pickMetrics(tenantId: string) {
  const tasks = await wmsDb.fulfillmentTask.findMany({
    where: { tenantId, status: { in: [...ACTIVE_PICK_STATUSES] } },
    include: { pickLines: true },
  })

  let itemsPicked = 0
  let itemsToPick = 0
  for (const task of tasks) {
    for (const line of task.pickLines) {
      itemsPicked += line.pickedQty
      itemsToPick += Math.max(0, line.quantity - line.pickedQty)
    }
  }
  return { itemsPicked, itemsToPick }
}

async function latestMsaStatus(tenantId: string): Promise<string> {
  const cfg = await complianceDb.mSATenant.findFirst({ where: { tenantId } })
  if (!cfg?.msaEnabled) return 'MSA_DISABLED'

  const report = await complianceDb.mSAReport.findFirst({
    where: { tenantId },
    orderBy: { weekEnding: 'desc' },
  })
  if (!report) return 'NO_REPORTS'
  return report.status
}

export async function listSnapshots(tenantId: string) {
  await syncRecentSnapshotsFromOrders(tenantId)
  return analyticsDb.dailyKpiSnapshot.findMany({
    where: { tenantId },
    orderBy: { date: 'desc' },
    take: 365,
  })
}

/** Dashboard KPIs from live orders, WMS picks, and compliance — not estimates. */
export async function dashboardKpis(tenantId: string) {
  await syncRecentSnapshotsFromOrders(tenantId)

  const today = new Date()
  const yesterday = addUtcDays(today, -1)

  const [todayOrders, yesterdayOrders, openOrders, pick, msaStatus] = await Promise.all([
    orderDayMetrics(tenantId, today),
    orderDayMetrics(tenantId, yesterday),
    orderDb.order.count({
      where: { tenantId, status: { in: [...OPEN_ORDER_STATUSES] } },
    }),
    pickMetrics(tenantId),
    latestMsaStatus(tenantId),
  ])

  return {
    todayRevenue: todayOrders.revenue,
    revenueTrend: pctChange(todayOrders.revenue, yesterdayOrders.revenue),
    openOrders,
    ordersTrend: pctChange(todayOrders.ordersCount, yesterdayOrders.ordersCount),
    itemsPicked: pick.itemsPicked,
    itemsToPick: pick.itemsToPick,
    msaStatus,
  }
}

export type RefreshKpiInput = {
  tenantId?: string
  date: string
  ordersCount: number
  revenue: number
  skusActive: number
}

export async function upsertSnapshot(
  sessionTenantId: string,
  role: string,
  dto: RefreshKpiInput,
) {
  let target = sessionTenantId
  if (dto.tenantId?.trim()) {
    if (role !== 'SUPER_ADMIN' && dto.tenantId.trim() !== sessionTenantId) {
      throw new ApiError(403, 'tenantId body only for SUPER_ADMIN')
    }
    target = dto.tenantId.trim()
  }

  const d = new Date(dto.date)
  const day = utcDayStart(d)

  return analyticsDb.dailyKpiSnapshot.upsert({
    where: { tenantId_date: { tenantId: target, date: day } },
    create: {
      tenantId: target,
      date: day,
      ordersCount: dto.ordersCount,
      revenue: new Prisma.Decimal(dto.revenue),
      skusActive: dto.skusActive,
    },
    update: {
      ordersCount: dto.ordersCount,
      revenue: new Prisma.Decimal(dto.revenue),
      skusActive: dto.skusActive,
    },
  })
}

/** Rebuild snapshots for the last N UTC days from order history. */
export async function syncSnapshotsFromOrders(tenantId: string, days = SNAPSHOT_SYNC_DAYS) {
  return syncRecentSnapshotsFromOrders(tenantId, days)
}
