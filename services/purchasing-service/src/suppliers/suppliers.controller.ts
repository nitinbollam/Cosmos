import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { TenantId } from '@cosmos/auth-middleware'
import { SuppliersService } from './suppliers.service'
import { CreateSupplierDto } from './dto/create-supplier.dto'
import { UpdateSupplierDto } from './dto/update-supplier.dto'

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.suppliers.list(tenantId)
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.suppliers.get(tenantId, id)
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateSupplierDto) {
    return this.suppliers.create(tenantId, dto)
  }

  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliers.update(tenantId, id, dto)
  }
}
