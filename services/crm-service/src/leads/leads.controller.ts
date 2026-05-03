import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { Roles, RolesGuard, TenantId } from '@cosmos/auth-middleware'
import { LeadsService } from './leads.service'
import { CreateLeadDto } from './dto/create-lead.dto'
import { ConvertLeadDto } from './dto/convert-lead.dto'

@Controller('leads')
@UseGuards(RolesGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.leads.list(tenantId)
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.leads.get(tenantId, id)
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateLeadDto) {
    return this.leads.create(tenantId, dto)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Post(':id/convert')
  convert(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: ConvertLeadDto) {
    return this.leads.convert(tenantId, id, dto)
  }
}
