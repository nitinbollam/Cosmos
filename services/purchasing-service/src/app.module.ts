import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { PassportModule } from '@nestjs/passport'
import { CosmosJwtStrategy, JwtAuthGuard, InternalOrJwtAuthGuard } from '@cosmos/auth-middleware'
import { PrismaService } from './prisma/prisma.service'
import { HealthController } from './health/health.controller'
import { SuppliersModule } from './suppliers/suppliers.module'
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module'

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PassportModule, SuppliersModule, PurchaseOrdersModule],
  controllers: [HealthController],
  providers: [
    PrismaService,
    {
      provide: CosmosJwtStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new CosmosJwtStrategy(config.get<string>('JWT_SECRET') ?? ''),
    },
    JwtAuthGuard,
    { provide: APP_GUARD, useClass: InternalOrJwtAuthGuard },
  ],
  exports: [PrismaService],
})
export class AppModule {}
