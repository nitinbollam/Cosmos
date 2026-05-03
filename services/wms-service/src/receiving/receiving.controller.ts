import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard, TenantId } from '@cosmos/auth-middleware'
import type { AuthenticatedUser } from '@cosmos/types'
import { ReceivingService } from './receiving.service'
import { StartReceivingSessionDto } from './dto/start-receiving-session.dto'
import { ScanReceivingItemDto } from './dto/scan-receiving-item.dto'
import { CompleteReceivingSessionDto } from './dto/complete-receiving-session.dto'

@Controller('wms/receiving')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Get('sessions')
  list(@TenantId() tenantId: string, @Query('status') status?: string) {
    return this.receiving.listSessions(tenantId, status)
  }

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Post('sessions')
  start(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartReceivingSessionDto,
  ) {
    return this.receiving.startSession(
      tenantId,
      dto.warehouseId,
      user.userId,
      dto.poId,
      dto.asnId,
    )
  }

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Post('sessions/:sessionId/scan')
  scan(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ScanReceivingItemDto,
  ) {
    return this.receiving.scanItem(sessionId, tenantId, user.userId, dto)
  }

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Get('sessions/:sessionId')
  get(@TenantId() tenantId: string, @Param('sessionId') sessionId: string) {
    return this.receiving.getSession(sessionId, tenantId)
  }

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Patch('sessions/:sessionId/complete')
  complete(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: CompleteReceivingSessionDto,
  ) {
    return this.receiving.completeSession(sessionId, tenantId, dto.notes)
  }
}
