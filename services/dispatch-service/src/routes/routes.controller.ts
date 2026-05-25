import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { Roles, RolesGuard, TenantId } from '@cosmos/auth-middleware'
import { RoutesService } from './routes.service'
import { CreateRouteDto } from './dto/create-route.dto'
import { AssignDriverDto } from './dto/assign-driver.dto'
import { ReorderStopsDto } from './dto/reorder-stops.dto'

@Controller('routes')
@UseGuards(RolesGuard)
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query('date') date?: string) {
    return this.routes.list(tenantId, date)
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.routes.get(tenantId, id)
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateRouteDto) {
    return this.routes.create(tenantId, dto)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Patch(':id/driver')
  assignDriver(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: AssignDriverDto) {
    return this.routes.assignDriver(tenantId, id, dto)
  }

  @Patch(':id/stops/reorder')
  reorderStops(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: ReorderStopsDto,
  ) {
    return this.routes.reorderStops(tenantId, id, dto.stopIds)
  }

  @Post(':routeId/stops/:stopId/delivered')
  markDelivered(
    @TenantId() tenantId: string,
    @Param('routeId') routeId: string,
    @Param('stopId') stopId: string,
    @Body() body?: Record<string, unknown>,
  ) {
    return this.routes.markStopDelivered(tenantId, routeId, stopId, body ?? undefined)
  }

  @Post(':routeId/stops/:stopId/failed')
  markFailed(
    @TenantId() tenantId: string,
    @Param('routeId') routeId: string,
    @Param('stopId') stopId: string,
    @Body() body: { reason?: string },
  ) {
    return this.routes.markStopFailed(tenantId, routeId, stopId, body?.reason)
  }
}
