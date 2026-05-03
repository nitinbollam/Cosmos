import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { of, throwError } from 'rxjs'
import { PrismaService } from '../prisma/prisma.service'
import { OrderSaga, SagaStatus } from './order.saga'

describe('OrderSaga compensation', () => {
  let saga: OrderSaga
  let http: { post: jest.Mock; delete: jest.Mock }
  let prismaMock: {
    order: { findFirst: jest.Mock; update: jest.Mock }
    orderSaga: { create: jest.Mock; update: jest.Mock }
  }
  let bus: { publish: jest.Mock }

  beforeEach(async () => {
    prismaMock = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'o1',
          tenantId: 'tenant1',
          paymentMethod: 'NET_TERMS',
          totalAmount: 100,
          customerId: 'cust1',
          priority: 'NORMAL',
          lineItems: [
            {
              skuId: 'sku1',
              warehouseId: 'wh1',
              quantity: 2,
              unitPrice: '10',
            },
          ],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      orderSaga: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    }

    http = {
      post: jest.fn().mockImplementation((url: string) => {
        const u = String(url)
        if (u.includes('/inventory/stock/reserve')) {
          return of({ data: { reservationId: 'res-xyz' } })
        }
        if (u.includes('/fulfillment/tasks')) {
          return throwError(() => new Error('wms unavailable'))
        }
        if (u.includes('/inventory/stock/release')) {
          return of({ data: { ok: true } })
        }
        return throwError(() => new Error(`unexpected POST ${url}`))
      }),
      delete: jest.fn(),
    }

    bus = { publish: jest.fn().mockResolvedValue(undefined) }

    const svcUrls: Record<string, string> = {
      INTERNAL_SERVICE_SECRET: 'test-internal',
      INVENTORY_SERVICE_URL: 'http://inventory.test',
      PAYMENT_SERVICE_URL: 'http://payment.test',
      WMS_SERVICE_URL: 'http://wms.test',
      COMPLIANCE_SERVICE_URL: 'http://compliance.test',
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderSaga,
        { provide: PrismaService, useValue: prismaMock },
        { provide: HttpService, useValue: http },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((k: string) => svcUrls[k] ?? '') },
        },
        { provide: EventBusClient, useValue: bus },
      ],
    }).compile()

    saga = moduleRef.get(OrderSaga)
  })

  it('releases inventory when fulfillment creation fails for NET_TERMS orders', async () => {
    await expect(saga.execute('o1', 'tenant1', 'corr-1')).rejects.toThrow('wms unavailable')

    expect(http.post.mock.calls[0][0]).toContain('/inventory/stock/reserve')

    const releaseCalls = http.post.mock.calls.filter((call) =>
      String(call[0]).includes('/inventory/stock/release'),
    )
    expect(releaseCalls.length).toBeGreaterThanOrEqual(1)
    expect(releaseCalls[0][1]).toMatchObject({ reservationId: 'res-xyz' })

    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    )

    expect(
      prismaMock.orderSaga.update.mock.calls.some(
        (c) => (c[0] as { data?: { status?: string } }).data?.status === SagaStatus.FAILED,
      ),
    ).toBe(true)

    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: EventType.ORDER_CANCELLED }),
    )
  })
})
