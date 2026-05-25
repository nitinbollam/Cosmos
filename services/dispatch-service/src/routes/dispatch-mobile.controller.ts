import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common'
import type { AuthenticatedUser } from '@cosmos/types'
import { CurrentUser, TenantId } from '@cosmos/auth-middleware'
import { RoutesService } from './routes.service'
import { DriverLocationDto } from './dto/driver-location.dto'

/**
 * Mobile-friendly paths under `/dispatch/*` (same service as `/routes/*`).
 */
@Controller('dispatch')
export class DispatchMobileController {
  constructor(private readonly routes: RoutesService) {}

  @Post('driver/location')
  driverLocation(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DriverLocationDto,
  ) {
    return this.routes.recordDriverLocation(tenantId, user.userId, body)
  }

  /** Full POD payload; **routeId** required in body (same as mark-stop-delivered). */
  @Post('stops/:stopId/pod')
  pod(
    @TenantId() tenantId: string,
    @Param('stopId') stopId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const routeId = String(body.routeId ?? '')
    if (!routeId.trim()) throw new BadRequestException('routeId is required in body')
    const { routeId: _r, stopId: _s, ...pod } = body
    return this.routes.markStopDelivered(tenantId, routeId, stopId, pod)
  }
}
