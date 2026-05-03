import { Module } from '@nestjs/common'
import { FulfillmentController } from './fulfillment.controller'
import { FulfillmentService } from './fulfillment.service'
import { WmsTasksController } from '../wms/wms-tasks.controller'
import { SyncController } from '../sync/sync.controller'
import { ReceivingModule } from '../receiving/receiving.module'
import { CycleCountController } from '../cycle-count/cycle-count.controller'
import { CycleCountService } from '../cycle-count/cycle-count.service'

@Module({
  imports: [ReceivingModule],
  controllers: [FulfillmentController, WmsTasksController, SyncController, CycleCountController],
  providers: [FulfillmentService, CycleCountService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
