import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { APP_GUARD } from '@nestjs/core'
import { PassportModule } from '@nestjs/passport'
import { CosmosJwtStrategy, JwtAuthGuard, InternalOrJwtAuthGuard } from '@cosmos/auth-middleware'
import { PrismaService } from './prisma/prisma.service'
import { MSAModule } from './msa/msa.module'
import { TaxModule } from './tax/tax.module'
import { BatchModule } from './batch/batch.module'
import { EventBusModule } from './events/event-bus.module'
import { HealthController } from './health/health.controller'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PassportModule,
    EventBusModule,
    MSAModule,
    TaxModule,
    BatchModule,
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
