import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { Roles, RolesGuard, TenantId } from '@cosmos/auth-middleware'
import { QuoteStatus } from '../generated/prisma-client'
import { QuotesService } from './quotes.service'
import { CreateQuoteDto } from './dto/create-quote.dto'

@Controller('quotes')
@UseGuards(RolesGuard)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query('status') status?: QuoteStatus) {
    return this.quotes.list(tenantId, status)
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.quotes.get(tenantId, id)
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateQuoteDto) {
    return this.quotes.create(tenantId, dto)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Post(':id/submit')
  submit(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Req() req: { headers: Record<string, string | string[] | undefined> },
  ) {
    return this.quotes.submit(tenantId, id, req.headers.authorization)
  }
}
