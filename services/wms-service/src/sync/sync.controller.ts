import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common'
import { FulfillmentService } from '../fulfillment/fulfillment.service'
import { ReplayDto } from './dto/replay.dto'

@Controller('sync')
export class SyncController {
  constructor(private fulfillment: FulfillmentService) {}

  @Get('pull')
  pull(@Req() req: { user: { tenantId: string } }, @Query('since') since?: string) {
    const sinceMs = since ? parseInt(since, 10) : 0
    return this.fulfillment.pullChanges(req.user.tenantId, Number.isFinite(sinceMs) ? sinceMs : 0)
  }

  @Post('push')
  push(@Req() req: { user: { tenantId: string } }, @Body() body: { changes?: Record<string, unknown> }) {
    return this.fulfillment.pushChanges(req.user.tenantId, body)
  }

  @Post('replay')
  replay(@Req() req: { user: { tenantId: string } }, @Body() dto: ReplayDto) {
    return this.fulfillment.replayAction(req.user.tenantId, dto.action, dto.payload)
  }
}
