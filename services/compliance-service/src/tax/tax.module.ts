import { Module } from '@nestjs/common'
import { TaxController } from './tax.controller'

import { PrismaModule } from '../prisma/prisma.module'
@Module({ imports: [PrismaModule], controllers: [TaxController] })
export class TaxModule {}
