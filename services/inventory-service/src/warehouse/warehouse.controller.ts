import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common'
import { WarehouseService, CreateWarehouseInput } from './warehouse.service'
import { PatchWarehouseDto } from './dto/patch-warehouse.dto'

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

  @Patch(':id')
  patch(
    @Req() req: { user: { tenantId: string } },
    @Param('id') id: string,
    @Body() body: PatchWarehouseDto,
  ) {
    if (body.isDefault === true) return this.warehouses.setDefault(req.user.tenantId, id)
    return this.warehouses.findById(req.user.tenantId, id)
  }
}
