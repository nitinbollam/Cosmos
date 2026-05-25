import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ConfigModule } from '@nestjs/config'
import { OrderController } from './order.controller'
import { OrderService } from './order.service'
import { OrderSaga } from './order.saga'

import { PrismaModule } from '../prisma/prisma.module'
@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    HttpModule.register({ timeout: 10_000, maxRedirects: 2 }),
  ],
  controllers: [OrderController],
  providers: [OrderService, OrderSaga],
  exports: [OrderService, OrderSaga],
})
export class OrderModule {}
