import { Module } from '@nestjs/common'
import { ChartAccountsController } from './chart-accounts.controller'
import { ChartAccountsService } from './chart-accounts.service'

@Module({
  controllers: [ChartAccountsController],
  providers: [ChartAccountsService],
  exports: [ChartAccountsService],
})
export class ChartAccountsModule {}
