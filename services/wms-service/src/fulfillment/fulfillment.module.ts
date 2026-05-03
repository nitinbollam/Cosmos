import { Module } from '@nestjs/common'
import { FulfillmentController } from './fulfillment.controller'
import { FulfillmentService } from './fulfillment.service'
import { WmsTasksController } from '../wms/wms-tasks.controller'
import { SyncController } from '../sync/sync.controller'

@Module({
  controllers: [FulfillmentController, WmsTasksController, SyncController],
  providers: [FulfillmentService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
