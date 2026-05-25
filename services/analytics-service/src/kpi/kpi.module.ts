import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { KpiController } from './kpi.controller'
import { AnalyticsDashboardController } from './analytics-dashboard.controller'
import { InternalController } from '../internal/internal.controller'
import { KpiService } from './kpi.service'

@Module({
  imports: [PrismaModule],
  controllers: [KpiController, AnalyticsDashboardController, InternalController],
  providers: [KpiService],
  exports: [KpiService],
})
export class KpiModule {}
