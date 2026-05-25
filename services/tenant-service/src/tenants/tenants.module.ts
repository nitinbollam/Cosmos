import { Module } from '@nestjs/common'
import { TenantsController } from './tenants.controller'
import { InternalTenantsController } from './internal-tenants.controller'
import { TenantsService } from './tenants.service'

import { PrismaModule } from '../prisma/prisma.module'
@Module({
  imports: [PrismaModule],
  controllers: [TenantsController, InternalTenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
