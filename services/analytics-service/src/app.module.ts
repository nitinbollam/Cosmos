import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { PassportModule } from '@nestjs/passport'
import { CosmosJwtStrategy, JwtAuthGuard, InternalOrJwtAuthGuard } from '@cosmos/auth-middleware'
import { PrismaModule } from './prisma/prisma.module'
import { HealthController } from './health/health.controller'
import { KpiModule } from './kpi/kpi.module'

@Module({
  imports: [PrismaModule, ConfigModule.forRoot({ isGlobal: true }), PassportModule, KpiModule],
  controllers: [HealthController],
  providers: [
    {
      provide: CosmosJwtStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new CosmosJwtStrategy(config.get<string>('JWT_SECRET') ?? ''),
    },
    JwtAuthGuard,
    { provide: APP_GUARD, useClass: InternalOrJwtAuthGuard },
  ],
})
export class AppModule {}
