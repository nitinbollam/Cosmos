import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { WarehouseService, CreateWarehouseInput } from './warehouse.service'

@Controller('warehouses')
export class WarehouseController {
  constructor(private warehouses: WarehouseService) {}

  @Get()
  list(@Req() req: { user: { tenantId: string } }) {
    return this.warehouses.list(req.user.tenantId)
  }

  @Get(':id')
  get(@Req() req: { user: { tenantId: string } }, @Param('id') id: string) {
    return this.warehouses.findById(req.user.tenantId, id)
  }

  @Post()
  create(@Req() req: { user: { tenantId: string } }, @Body() body: CreateWarehouseInput) {
    return this.warehouses.create(req.user.tenantId, body)
  }
}
