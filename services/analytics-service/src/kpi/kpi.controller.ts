import { BadRequestException, Controller, Get, UseGuards } from '@nestjs/common'
import { RolesGuard, TenantId } from '@cosmos/auth-middleware'
import { KpiService } from './kpi.service'

@Controller('kpi')
@UseGuards(RolesGuard)
export class KpiController {
  constructor(private readonly kpi: KpiService) {}

  @Get('snapshots')
  list(@TenantId() tenantId: string) {
    return this.kpi.listSnapshots(tenantId)
  }
}
