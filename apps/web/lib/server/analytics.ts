import { Prisma } from '@/generated/prisma-analytics'
import { analyticsDb } from './db'
import { ApiError } from './session'

export function listSnapshots(tenantId: string) {
  return analyticsDb.dailyKpiSnapshot.findMany({
    where: { tenantId },
    orderBy: { date: 'desc' },
    take: 365,
  })
}

/** Dashboard KPI shape used by admin home. */
export async function dashboardKpis(tenantId: string) {
  const rows = await analyticsDb.dailyKpiSnapshot.findMany({
    where: { tenantId },
    orderBy: { date: 'desc' },
    take: 14,
  })
  const today = rows[0]
  const prior = rows[1]
  const todayRevenue = today ? Number(today.revenue) : 0
  const yesterdayRevenue = prior ? Number(prior.revenue) : todayRevenue
  const revenueTrend =
    yesterdayRevenue > 0 ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100 : todayRevenue > 0 ? 100 : 0

  const openOrdersApprox = today ? Math.max(0, Math.round(today.ordersCount * 0.35)) : 0
  const ordersPrior = prior?.ordersCount ?? today?.ordersCount ?? 0
  const ordersTrend =
    ordersPrior > 0 ? (((today?.ordersCount ?? 0) - ordersPrior) / ordersPrior) * 100 : 0

  return {
    todayRevenue,
    revenueTrend,
    openOrders: openOrdersApprox,
    ordersTrend,
    itemsPicked: Math.max(0, Math.round((today?.ordersCount ?? 0) * 2.5)),
    msaStatus: today ? 'SEE_COMPLIANCE' : 'NO_DATA',
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
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

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
