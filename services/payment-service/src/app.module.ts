import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { PassportModule } from '@nestjs/passport'
import { CosmosJwtStrategy, JwtAuthGuard, InternalOrJwtAuthGuard } from '@cosmos/auth-middleware'
import { PrismaService } from './prisma/prisma.service'
import { IdempotencyModule } from '@cosmos/idempotency'
import { EventBusModule } from './events/event-bus.module'
import { HealthController } from './health/health.controller'
import { PaymentsModule } from './payments/payments.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PassportModule,
    EventBusModule,
    IdempotencyModule.register({
      redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    }),
    PaymentsModule,
  ],
  controllers: [HealthController],
  providers: [
    PrismaService,
    {
      provide: CosmosJwtStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new CosmosJwtStrategy(config.get<string>('JWT_SECRET') ?? 'dev'),
    },
    JwtAuthGuard,
    { provide: APP_GUARD, useClass: InternalOrJwtAuthGuard },
  ],
  exports: [PrismaService],
})
export class AppModule {}
