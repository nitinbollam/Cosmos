import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { PassportModule } from '@nestjs/passport'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { CosmosJwtStrategy, JwtAuthGuard } from '@cosmos/auth-middleware'
import { HealthController } from './health/health.controller'
import { ProxyModule } from './proxy/proxy.module'
import { WebhookModule } from './webhook/webhook.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PassportModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 200 }]),
    ProxyModule,
    WebhookModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: CosmosJwtStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new CosmosJwtStrategy(config.get<string>('JWT_SECRET') ?? 'dev'),
    },
    JwtAuthGuard,
  ],
})
export class AppModule {}
