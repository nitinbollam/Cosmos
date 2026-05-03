import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import {
  EventBusClient,
  EventType,
  type OrderCreatedPayload,
  type ReceivingCompletedPayload,
  dlqMonitorFromEnv,
} from '@cosmos/event-bus'
import { NotificationChannel } from '../generated/prisma-client'
import { NotificationsService } from '../notifications/notifications.service'

@Injectable()
export class OrderEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OrderEventsConsumer.name)

  constructor(
    private readonly bus: EventBusClient,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.bus.subscribe<OrderCreatedPayload>(
      EventType.ORDER_CREATED,
      async (event) => {
        const p = event.payload as OrderCreatedPayload
        await this.notifications.enqueue(
          event.tenantId,
          {
            channel: NotificationChannel.EMAIL,
            recipient: `orders+${encodeURIComponent(event.tenantId)}@notifications.internal`,
            templateKey: 'order.created',
            payload: {
              orderId: p.orderId,
              customerId: p.customerId,
              totalAmount: p.totalAmount,
              channel: p.channel,
            },
          },
          `order-created:${event.id}`,
        )
        this.log.debug({ eventId: event.id, orderId: p.orderId }, 'order created notification enqueued')
      },
      { dlq: dlqMonitorFromEnv('notification-service') },
    )

    this.bus.subscribe<ReceivingCompletedPayload>(
      EventType.RECEIVING_COMPLETED,
      async (event) => {
        const p = event.payload as ReceivingCompletedPayload
        await this.notifications.enqueue(
          event.tenantId,
          {
            channel: NotificationChannel.EMAIL,
            recipient: `receiving+${encodeURIComponent(event.tenantId)}@notifications.internal`,
            templateKey: 'receiving.completed',
            payload: {
              sessionId: p.sessionId,
              warehouseId: p.warehouseId,
              poId: p.poId,
              itemCount: p.itemCount,
              hasDiscrepancy: p.hasDiscrepancy,
            },
          },
          `receiving-completed:${event.id}`,
        )
        this.log.debug({ eventId: event.id, sessionId: p.sessionId }, 'receiving completed notification enqueued')
      },
      { dlq: dlqMonitorFromEnv('notification-service') },
    )

    this.log.log('subscribed to ORDER_CREATED and RECEIVING_COMPLETED')
  }

  async onModuleDestroy() {
    await this.bus.shutdown()
  }
}
