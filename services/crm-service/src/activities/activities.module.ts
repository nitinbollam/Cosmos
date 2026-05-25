import { Module } from '@nestjs/common'
import { ActivitiesController } from './activities.controller'
import { ActivitiesService } from './activities.service'

import { PrismaModule } from '../prisma/prisma.module'
@Module({ imports: [PrismaModule], controllers: [ActivitiesController], providers: [ActivitiesService], exports: [ActivitiesService] })
export class ActivitiesModule {}
