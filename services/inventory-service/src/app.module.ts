import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { CosmosJwtStrategy, JwtAuthGuard, InternalOrJwtAuthGuard } from '@cosmos/auth-middleware'
import { ConfigService } from '@nestjs/config'
import { PrismaModule } from './prisma/prisma.module'
import { InventoryModule } from './inventory/inventory.module'
import { SkuModule } from './sku/sku.module'
import { WarehouseModule } from './warehouse/warehouse.module'
import { EventBusModule } from './events/event-bus.module'
import { ReservationExpirer } from './events/reservation-expirer'
import { HealthController } from './health/health.controller'
import { PassportModule } from '@nestjs/passport'

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ isGlobal: true }),
    PassportModule,
    EventBusModule,
    InventoryModule,
    SkuModule,
    WarehouseModule,
  ],
  controllers: [HealthController],
  providers: [
    ReservationExpirer,
    {
      provide: CosmosJwtStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new CosmosJwtStrategy(config.get<string>('JWT_SECRET') ?? 'dev'),
    },
    JwtAuthGuard,
    { provide: APP_GUARD, useClass: InternalOrJwtAuthGuard },
  ],
})
export class AppModule {}
