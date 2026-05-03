import { Controller, Get, Param, Query, Req } from '@nestjs/common'
import { FulfillmentService } from '../fulfillment/fulfillment.service'

@Controller('wms')
export class WmsTasksController {
  constructor(private fulfillment: FulfillmentService) {}

  @Get('tasks/:taskId')
  getTask(
    @Req() req: { user: { tenantId: string } },
    @Param('taskId') taskId: string,
  ) {
    return this.fulfillment.getTaskForFloor(req.user.tenantId, taskId)
  }

  @Get('tasks')
  list(@Req() req: { user: { tenantId: string } }, @Query('status') status?: string) {
    return this.fulfillment.listTasksForFloor(req.user.tenantId, status)
  }
}
