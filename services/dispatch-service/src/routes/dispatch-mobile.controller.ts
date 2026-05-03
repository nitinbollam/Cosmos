import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common'
import { TenantId } from '@cosmos/auth-middleware'
import { RoutesService } from './routes.service'

/**
 * Mobile-friendly paths under `/dispatch/*` (same service as `/routes/*`).
 */
@Controller('dispatch')
export class DispatchMobileController {
  constructor(private readonly routes: RoutesService) {}

  @Post('driver/location')
  driverLocation(
    @TenantId() tenantId: string,
    @Body() body: { lat: number; lng: number; timestamp?: string },
  ) {
    return this.routes.recordDriverLocation(tenantId, body)
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
