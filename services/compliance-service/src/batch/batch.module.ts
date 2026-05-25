import { Module } from '@nestjs/common'
import { BatchService } from './batch.service'

import { PrismaModule } from '../prisma/prisma.module'
@Module({ imports: [PrismaModule], providers: [BatchService], exports: [BatchService] })
export class BatchModule {}
