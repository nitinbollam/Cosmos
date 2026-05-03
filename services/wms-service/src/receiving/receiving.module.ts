import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ReceivingService } from './receiving.service'
import { ReceivingController } from './receiving.controller'
import { EventBusModule } from '../events/event-bus.module'

@Module({
  imports: [HttpModule, EventBusModule],
  controllers: [ReceivingController],
  providers: [ReceivingService],
})
export class ReceivingModule {}
