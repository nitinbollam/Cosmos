import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { Roles, RolesGuard, TenantId } from '@cosmos/auth-middleware'
import { ChartAccountsService } from './chart-accounts.service'
import { CreateChartAccountDto } from './dto/create-account.dto'
import { PatchChartAccountDto } from './dto/patch-account.dto'

@Controller('chart-accounts')
@UseGuards(RolesGuard)
export class ChartAccountsController {
  constructor(private readonly accounts: ChartAccountsService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.accounts.list(tenantId)
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.accounts.get(tenantId, id)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateChartAccountDto) {
    return this.accounts.create(tenantId, dto)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Patch(':id')
  patch(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: PatchChartAccountDto) {
    return this.accounts.patch(tenantId, id, dto)
  }
}
