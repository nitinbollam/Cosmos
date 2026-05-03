import { Module } from '@nestjs/common'
import { EventBusModule } from './event-bus.module'
import { OrderEventsConsumer } from './order-events.consumer'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [EventBusModule, NotificationsModule],
  providers: [OrderEventsConsumer],
})
export class EventsModule {}
