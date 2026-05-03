import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard, Roles, RolesGuard } from '@cosmos/auth-middleware'
import { CartonService } from './carton.service'
import { AddCartonItemDto, CreateCartonDto, SealCartonDto } from './dto/carton.dto'

@Controller('wms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CartonController {
  constructor(private readonly cartons: CartonService) {}

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Post('tasks/:taskId/cartons')
  createCarton(
    @Req() req: { user: { tenantId: string } },
    @Param('taskId') taskId: string,
    @Body() dto: CreateCartonDto,
  ) {
    return this.cartons.createCarton(req.user.tenantId, taskId, dto)
  }

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Post('cartons/:cartonId/items')
  addItem(
    @Req() req: { user: { tenantId: string } },
    @Param('cartonId') cartonId: string,
    @Body() dto: AddCartonItemDto,
  ) {
    return this.cartons.addItemToCarton(req.user.tenantId, cartonId, dto)
  }

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Post('cartons/:cartonId/seal')
  seal(
    @Req() req: { user: { tenantId: string } },
    @Param('cartonId') cartonId: string,
    @Body() dto: SealCartonDto,
  ) {
    return this.cartons.sealCarton(req.user.tenantId, cartonId, dto)
  }

  @Roles('WAREHOUSE_STAFF', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN')
  @Get('tasks/:taskId/cartons')
  listForTask(@Req() req: { user: { tenantId: string } }, @Param('taskId') taskId: string) {
    return this.cartons.listCartonsForTask(req.user.tenantId, taskId)
  }
}
