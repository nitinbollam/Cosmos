import { Injectable } from '@nestjs/common'
import { Prisma } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'
import { RefreshKpiDto } from './dto/refresh-kpi.dto'

@Injectable()
export class KpiService {
  constructor(private readonly prisma: PrismaService) {}

  listSnapshots(tenantId: string) {
    return this.prisma.dailyKpiSnapshot.findMany({
      where: { tenantId },
      orderBy: { date: 'desc' },
      take: 365,
    })
  }

  /** Shape expected by apps/web-admin dashboard. Uses latest KPI rows; open orders inferred from totals. */
  async dashboardKpis(tenantId: string) {
    const rows = await this.prisma.dailyKpiSnapshot.findMany({
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

  async upsertSnapshot(resolvedTenantId: string, dto: RefreshKpiDto) {
    const d = new Date(dto.date)
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    return this.prisma.dailyKpiSnapshot.upsert({
      where: {
        tenantId_date: { tenantId: resolvedTenantId, date: day },
      },
      create: {
        tenantId: resolvedTenantId,
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
}
