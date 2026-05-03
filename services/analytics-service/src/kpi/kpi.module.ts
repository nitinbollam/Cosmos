import { Module } from '@nestjs/common'
import { KpiController } from './kpi.controller'
import { AnalyticsDashboardController } from './analytics-dashboard.controller'
import { InternalController } from '../internal/internal.controller'
import { KpiService } from './kpi.service'

@Module({
  controllers: [KpiController, AnalyticsDashboardController, InternalController],
  providers: [KpiService],
  exports: [KpiService],
})
export class KpiModule {}
