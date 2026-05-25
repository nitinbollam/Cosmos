import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { APP_GUARD } from '@nestjs/core'
import { PassportModule } from '@nestjs/passport'
import { HttpModule } from '@nestjs/axios'
import { CosmosJwtStrategy, JwtAuthGuard, InternalOrJwtAuthGuard } from '@cosmos/auth-middleware'
import { PrismaModule } from './prisma/prisma.module'
import { MSAModule } from './msa/msa.module'
import { TaxModule } from './tax/tax.module'
import { BatchModule } from './batch/batch.module'
import { EventBusModule } from './events/event-bus.module'
import { HealthController } from './health/health.controller'
import { ComplianceRouterService } from './compliance-router.service'
import { GeneralComplianceEngine } from './engines/general.engine'
import { PharmaComplianceEngine } from './engines/pharma.engine'
import { AlcoholComplianceEngine } from './engines/alcohol.engine'

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PassportModule,
    HttpModule,
    EventBusModule,
    MSAModule,
    TaxModule,
    BatchModule,
  ],
  controllers: [HealthController],
  providers: [
    ComplianceRouterService,
    GeneralComplianceEngine,
    PharmaComplianceEngine,
    AlcoholComplianceEngine,
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
