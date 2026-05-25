import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard, TenantId } from '@cosmos/auth-middleware'
import type { AuthenticatedUser } from '@cosmos/types'
import type { CycleCountType } from '../generated/prisma-client'
import { PatchCycleLineDto } from './dto/patch-cycle-line.dto'
import { ImportCycleLinesDto } from './dto/import-cycle-lines.dto'
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
  @Post(':id/lines/import')
  importLines(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: ImportCycleLinesDto,
  ) {
    return this.cycleCounts.importLineCounts(tenantId, id, body.rows)
  }

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Patch(':id/lines/:lineId')
  updateLine(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: PatchCycleLineDto,
  ) {
    return this.cycleCounts.updateLineCountedQty(tenantId, id, lineId, body.countedQty)
  }

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Patch(':id/submit-for-approval')
  submit(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cycleCounts.submitForApproval(tenantId, id)
  }

  @Roles('MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approvePost(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cycleCounts.approve(tenantId, id)
  }

  /** @deprecated Prefer POST :id/approve */
  @Roles('MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Patch(':id/approve')
  approvePatch(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cycleCounts.approve(tenantId, id)
  }
}
