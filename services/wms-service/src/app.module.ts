import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { PassportModule } from '@nestjs/passport'
import { ConfigService } from '@nestjs/config'
import {
  CosmosJwtStrategy,
  JwtAuthGuard,
  InternalOrJwtAuthGuard,
} from '@cosmos/auth-middleware'
import { FulfillmentModule } from './fulfillment/fulfillment.module'
import { EventBusModule } from './events/event-bus.module'
import { HealthController } from './health/health.controller'
import { PrismaModule } from './prisma/prisma.module'

import { CartonModule } from './carton/carton.module'
import { ReceivingModule } from './receiving/receiving.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PassportModule,
    PrismaModule,
    EventBusModule,
    FulfillmentModule,
    ReceivingModule,
    CartonModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: CosmosJwtStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new CosmosJwtStrategy(config.get<string>('JWT_SECRET') ?? 'dev'),
    },
    JwtAuthGuard,
    { provide: APP_GUARD, useClass: InternalOrJwtAuthGuard },
  ],
})
export class AppModule {}
