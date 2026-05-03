import { Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common'
import { CurrentUser, Roles, RolesGuard, TenantId } from '@cosmos/auth-middleware'
import type { AuthenticatedUser } from '@cosmos/types'
import { KpiService } from '../kpi/kpi.service'
import { RefreshKpiDto } from '../kpi/dto/refresh-kpi.dto'

@Controller('internal')
@UseGuards(RolesGuard)
export class InternalController {
  constructor(private readonly kpi: KpiService) {}

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Post('refresh')
  refresh(
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
    @Body() dto: RefreshKpiDto,
  ) {
    let target = tenantId
    if (dto.tenantId?.trim()) {
      if (user.role !== 'SUPER_ADMIN' && dto.tenantId.trim() !== tenantId) {
        throw new ForbiddenException('tenantId body only for SUPER_ADMIN')
      }
      target = dto.tenantId.trim()
    }
    return this.kpi.upsertSnapshot(target, dto)
  }
}
