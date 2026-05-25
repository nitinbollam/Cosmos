import { Module } from '@nestjs/common'
import { CartonController } from './carton.controller'
import { CartonService } from './carton.service'
import { ShippingLabelService } from './shipping-label.service'

import { PrismaModule } from '../prisma/prisma.module'
@Module({
  imports: [PrismaModule],
  controllers: [CartonController],
  providers: [CartonService, ShippingLabelService],
})
export class CartonModule {}
