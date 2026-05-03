import { Module } from '@nestjs/common'
import { SkuController } from './sku.controller'
import { SkuService } from './sku.service'

@Module({
  controllers: [SkuController],
  providers: [SkuService],
  exports: [SkuService],
})
export class SkuModule {}
