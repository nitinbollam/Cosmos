import { Controller, Get, UseGuards } from '@nestjs/common'
import { RolesGuard, TenantId } from '@cosmos/auth-middleware'
import { KpiService } from './kpi.service'

/** Web-admin dashboard compatibility routes. */
@Controller('analytics')
@UseGuards(RolesGuard)
export class AnalyticsDashboardController {
  constructor(private readonly kpi: KpiService) {}

  @Get('kpis')
  dashboard(@TenantId() tenantId: string) {
    return this.kpi.dashboardKpis(tenantId)
  }
}
