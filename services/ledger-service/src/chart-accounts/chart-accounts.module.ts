import { Module } from '@nestjs/common'
import { ChartAccountsController } from './chart-accounts.controller'
import { ChartAccountsService } from './chart-accounts.service'

import { PrismaModule } from '../prisma/prisma.module'
@Module({
  imports: [PrismaModule],
  controllers: [ChartAccountsController],
  providers: [ChartAccountsService],
  exports: [ChartAccountsService],
})
export class ChartAccountsModule {}
