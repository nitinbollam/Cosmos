import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard, TenantId } from '@cosmos/auth-middleware'
import type { AuthenticatedUser } from '@cosmos/types'
import type { CycleCountType } from '../generated/prisma-client'
import { CycleCountService } from './cycle-count.service'

@Controller('wms/cycle-counts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CycleCountController {
  constructor(private readonly cycleCounts: CycleCountService) {}

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Get()
  list(@TenantId() tenantId: string) {
    return this.cycleCounts.list(tenantId)
  }

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cycleCounts.get(tenantId, id)
  }

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Post()
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { warehouseId: string; type: CycleCountType; scheduledFor?: string | null },
  ) {
    if (!body?.warehouseId) {
      throw new BadRequestException('warehouseId is required')
    }
    if (!body?.type) {
      throw new BadRequestException('type is required')
    }
    return this.cycleCounts.create(tenantId, user.userId, {
      warehouseId: body.warehouseId,
      type: body.type,
      scheduledFor: body.scheduledFor,
    })
  }

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Patch(':id/submit-for-approval')
  submit(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cycleCounts.submitForApproval(tenantId, id)
  }

  @Roles('MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Patch(':id/approve')
  approve(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cycleCounts.approve(tenantId, id)
  }
}
