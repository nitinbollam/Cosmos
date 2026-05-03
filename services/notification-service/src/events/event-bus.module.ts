import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EventBusClient } from '@cosmos/event-bus'

@Global()
@Module({
  providers: [
    {
      provide: EventBusClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new EventBusClient({
          redisUrl: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
          serviceName: 'notification-service',
        }),
    },
  ],
  exports: [EventBusClient],
})
export class EventBusModule {}
