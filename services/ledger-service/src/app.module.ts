import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { PassportModule } from '@nestjs/passport'
import { CosmosJwtStrategy, JwtAuthGuard, InternalOrJwtAuthGuard } from '@cosmos/auth-middleware'
import { PrismaModule } from './prisma/prisma.module'
import { HealthController } from './health/health.controller'
import { ChartAccountsModule } from './chart-accounts/chart-accounts.module'
import { JournalEntriesModule } from './journal-entries/journal-entries.module'
import { ReportsController } from './reports/reports.controller'
import { ReportsService } from './reports/reports.service'

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ isGlobal: true }),
    PassportModule,
    ChartAccountsModule,
    JournalEntriesModule,
  ],
  controllers: [HealthController, ReportsController],
  providers: [
    {
      provide: CosmosJwtStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new CosmosJwtStrategy(config.get<string>('JWT_SECRET') ?? ''),
    },
    JwtAuthGuard,
    { provide: APP_GUARD, useClass: InternalOrJwtAuthGuard },
    ReportsService,
  ],
})
export class AppModule {}
