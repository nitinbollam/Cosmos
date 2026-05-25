import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { Roles, RolesGuard, TenantId } from '@cosmos/auth-middleware'
import { LeadsService } from './leads.service'
import { CreateLeadDto } from './dto/create-lead.dto'
import { ConvertLeadDto } from './dto/convert-lead.dto'
import { ImportLeadsDto } from './dto/import-leads.dto'
import { PatchLeadDto } from './dto/patch-lead.dto'

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

  @Post('import')
  import(@TenantId() tenantId: string, @Body() dto: ImportLeadsDto) {
    return this.leads.importBulk(tenantId, dto.rows)
  }

  @Patch(':id')
  patch(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: PatchLeadDto) {
    return this.leads.patch(tenantId, id, dto)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN', 'MANAGER', 'SALES_REP')
  @Post(':id/convert')
  convert(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: ConvertLeadDto) {
    return this.leads.convert(tenantId, id, dto)
  }
}
