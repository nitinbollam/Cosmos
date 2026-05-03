import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import { FulfillmentService } from './fulfillment.service'
import { CancelFulfillmentDto, CreateFulfillmentTaskDto } from './dto/create-fulfillment-task.dto'

@Controller('fulfillment')
export class FulfillmentController {
  constructor(private fulfillment: FulfillmentService) {}

  @Post('tasks')
  create(@Req() req: { user: { tenantId: string } }, @Body() dto: CreateFulfillmentTaskDto) {
    return this.fulfillment.createTask(req.user.tenantId, dto)
  }

  @Delete('tasks/:orderId')
  cancel(
    @Req() req: { user: { tenantId: string } },
    @Param('orderId') orderId: string,
    @Body() body: CancelFulfillmentDto,
  ) {
    return this.fulfillment.cancelByOrder(req.user.tenantId, orderId, body.correlationId)
  }

  @Post('tasks/:taskId/pack')
  pack(@Req() req: { user: { tenantId: string } }, @Param('taskId') taskId: string) {
    return this.fulfillment.markPacked(req.user.tenantId, taskId)
  }

  @Post('tasks/:taskId/dispatch')
  dispatch(@Req() req: { user: { tenantId: string } }, @Param('taskId') taskId: string) {
    return this.fulfillment.markDispatched(req.user.tenantId, taskId)
  }
}
