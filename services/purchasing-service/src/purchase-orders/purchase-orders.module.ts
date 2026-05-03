import { Module } from '@nestjs/common'
import { PurchaseOrdersController } from './purchase-orders.controller'
import { PurchaseOrdersService } from './purchase-orders.service'

@Module({
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
