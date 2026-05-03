import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { Roles, RolesGuard, TenantId } from '@cosmos/auth-middleware'
import { JournalEntriesService } from './journal-entries.service'
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto'

@Controller('journal-entries')
@UseGuards(RolesGuard)
export class JournalEntriesController {
  constructor(private readonly entries: JournalEntriesService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.entries.list(tenantId)
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.entries.get(tenantId, id)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateJournalEntryDto) {
    return this.entries.createDraft(tenantId, dto)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Post(':id/post')
  post(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.entries.post(tenantId, id)
  }
}
