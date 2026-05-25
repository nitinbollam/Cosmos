import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { PassportModule } from '@nestjs/passport'
import { CosmosJwtStrategy, JwtAuthGuard } from '@cosmos/auth-middleware'
import { PrismaModule } from './prisma/prisma.module'
import { OrderModule } from './order/order.module'
import { EventBusModule } from './events/event-bus.module'
import { HealthController } from './health/health.controller'

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ isGlobal: true }),
    PassportModule,
    EventBusModule,
    OrderModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: CosmosJwtStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new CosmosJwtStrategy(config.get<string>('JWT_SECRET') ?? 'dev'),
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
