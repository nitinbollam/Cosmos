import { Module } from '@nestjs/common'
import { CustomersController } from './customers.controller'
import { CustomersService } from './customers.service'

import { PrismaModule } from '../prisma/prisma.module'
@Module({ imports: [PrismaModule], controllers: [CustomersController], providers: [CustomersService], exports: [CustomersService] })
export class CustomersModule {}
