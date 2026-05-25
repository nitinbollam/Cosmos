import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { RolesGuard, TenantId } from '@cosmos/auth-middleware'
import { ReportsService } from './reports.service'

@Controller('reports')
@UseGuards(RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Posted journal activity by account for calendar month (finance trial balance helper). */
  @Get('trial-balance')
  trialBalance(
    @TenantId() tenantId: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear()
    const m = month ? parseInt(month, 10) : new Date().getMonth() + 1
    return this.reports.trialBalance(tenantId, y, m)
  }
}
