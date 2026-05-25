import { Module } from '@nestjs/common'
import { SkuController } from './sku.controller'
import { SkuService } from './sku.service'

import { PrismaModule } from '../prisma/prisma.module'
@Module({
  imports: [PrismaModule],
  controllers: [SkuController],
  providers: [SkuService],
  exports: [SkuService],
})
export class SkuModule {}
