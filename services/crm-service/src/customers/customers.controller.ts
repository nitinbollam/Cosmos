import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { TenantId } from '@cosmos/auth-middleware'
import { CustomersService } from './customers.service'
import { CreateCustomerDto } from './dto/create-customer.dto'
import { ImportCustomersDto } from './dto/import-customers.dto'
import { PatchCustomerDto } from './dto/patch-customer.dto'

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.customers.list(tenantId)
  }

  /** Match B2B `customerRef` — must stay above `:id`. */
  @Get('lookup')
  lookup(
    @TenantId() tenantId: string,
    @Query('externalRef') externalRef?: string,
  ) {
    if (!externalRef?.trim()) throw new BadRequestException('externalRef query required')
    return this.customers.findByExternalRef(tenantId, externalRef.trim())
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.customers.get(tenantId, id)
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateCustomerDto) {
    return this.customers.create(tenantId, dto)
  }

  @Post('import')
  import(@TenantId() tenantId: string, @Body() dto: ImportCustomersDto) {
    return this.customers.importBulk(tenantId, dto.rows)
  }

  @Patch(':id')
  patch(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: PatchCustomerDto) {
    return this.customers.patch(tenantId, id, dto)
  }
}
