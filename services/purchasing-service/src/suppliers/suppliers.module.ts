import { Module } from '@nestjs/common'
import { SuppliersController } from './suppliers.controller'
import { SuppliersService } from './suppliers.service'

import { PrismaModule } from '../prisma/prisma.module'
@Module({ imports: [PrismaModule], controllers: [SuppliersController], providers: [SuppliersService], exports: [SuppliersService] })
export class SuppliersModule {}
