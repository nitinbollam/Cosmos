import { Module } from '@nestjs/common'
import { RoutesController } from './routes.controller'
import { DispatchMobileController } from './dispatch-mobile.controller'
import { RoutesService } from './routes.service'

import { PrismaModule } from '../prisma/prisma.module'
@Module({
  imports: [PrismaModule],
  controllers: [RoutesController, DispatchMobileController],
  providers: [RoutesService],
  exports: [RoutesService],
})
export class RoutesModule {}
