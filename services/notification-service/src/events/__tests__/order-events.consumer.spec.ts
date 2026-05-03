import { EventBusClient, EventType } from '@cosmos/event-bus'
import { NotificationChannel } from '../../generated/prisma-client'
import { NotificationsService } from '../../notifications/notifications.service'
import { OrderEventsConsumer } from '../order-events.consumer'

describe('OrderEventsConsumer', () => {
  const subscribe = jest.fn()
  const shutdown = jest.fn().mockResolvedValue(undefined)
  const bus = { subscribe, shutdown } as unknown as EventBusClient
  const enqueue = jest.fn().mockResolvedValue({ id: 'n1' })
  const notifications = { enqueue } as unknown as NotificationsService

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('subscribes to ORDER_CREATED and RECEIVING_COMPLETED with handlers', () => {
    const c = new OrderEventsConsumer(bus, notifications)
    c.onModuleInit()
    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(subscribe.mock.calls[0][0]).toBe(EventType.ORDER_CREATED)
    expect(subscribe.mock.calls[1][0]).toBe(EventType.RECEIVING_COMPLETED)
    expect(typeof subscribe.mock.calls[0][1]).toBe('function')
    expect(typeof subscribe.mock.calls[1][1]).toBe('function')
  })

  it('handler enqueues idempotent notification row', async () => {
    const c = new OrderEventsConsumer(bus, notifications)
    c.onModuleInit()
    const handler = subscribe.mock.calls[0][1] as (ev: unknown, job: unknown) => Promise<void>
    await handler(
      {
        id: 'e1',
        type: EventType.ORDER_CREATED,
        tenantId: 't1',
        timestamp: new Date(),
        correlationId: 'c1',
        version: 1,
        payload: {
          orderId: 'o1',
          customerId: 'cu1',
          lineItems: [],
          totalAmount: 100,
          channel: 'SALES_REP',
        },
      },
      {},
    )
    expect(enqueue).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        channel: NotificationChannel.EMAIL,
        templateKey: 'order.created',
        payload: expect.objectContaining({ orderId: 'o1', customerId: 'cu1', totalAmount: 100 }),
      }),
      'order-created:e1',
    )
  })

  it('shuts down bus on destroy', async () => {
    const c = new OrderEventsConsumer(bus, notifications)
    await c.onModuleDestroy()
    expect(shutdown).toHaveBeenCalled()
  })
})
