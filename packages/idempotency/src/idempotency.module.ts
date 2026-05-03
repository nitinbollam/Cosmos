import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import Redis from 'ioredis'
import { COSMOS_IDEMPOTENCY_REDIS } from './cosmos-idempotency.constants'
import { IdempotencyMiddleware } from './idempotency.middleware'

export interface IdempotencyModuleOptions {
  redisUrl: string
}

/**
 * Registers Redis-backed idempotency. Apply routes in AppModule.configure(), or pass route paths here later.
 * Default: attaches middleware to all routes (narrow with configure() override in consuming service).
 */
@Module({})
export class IdempotencyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(IdempotencyMiddleware).forRoutes('*')
  }

  static register(opts: IdempotencyModuleOptions): DynamicModule {
    return {
      module: IdempotencyModule,
      providers: [
        {
          provide: COSMOS_IDEMPOTENCY_REDIS,
          useFactory: () =>
            new Redis(opts.redisUrl, {
              maxRetriesPerRequest: null,
              enableReadyCheck: false,
            }),
        },
        IdempotencyMiddleware,
      ],
      exports: [IdempotencyMiddleware, COSMOS_IDEMPOTENCY_REDIS],
    }
  }
}
