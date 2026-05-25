import { Controller, Get, NotFoundException, Param } from '@nestjs/common'
import { TenantsService } from './tenants.service'

@Controller('internal/tenants')
export class InternalTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get(':id')
  async getInternal(@Param('id') id: string) {
    const tenant = await this.tenants.findById(id)
    if (!tenant) throw new NotFoundException('Tenant not found')
    return tenant
  }
}
