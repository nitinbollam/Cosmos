import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ReceivingService } from './receiving.service'
import { ReceivingController } from './receiving.controller'
import { EventBusModule } from '../events/event-bus.module'

import { PrismaModule } from '../prisma/prisma.module'
@Module({
  imports: [PrismaModule, HttpModule, EventBusModule],
  controllers: [ReceivingController],
  providers: [ReceivingService],
  exports: [ReceivingService],
})
export class ReceivingModule {}
