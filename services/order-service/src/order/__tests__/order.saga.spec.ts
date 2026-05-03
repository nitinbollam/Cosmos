import { OrderSaga } from '../order.saga'
import { of, throwError } from 'rxjs'

describe('OrderSaga', () => {
  let prisma: any
  let bus: any
  let http: any
  let config: any
  let saga: OrderSaga

  beforeEach(() => {
    prisma = {
      order: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      orderSaga: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    }
    bus = { publish: jest.fn().mockResolvedValue(undefined) }
    http = { post: jest.fn(), delete: jest.fn().mockReturnValue(of({ data: {} })) }
    config = { get: (k: string) => `http://${k}` }

    saga = new OrderSaga(prisma, bus, http, config)
  })

  it('compensates inventory when payment fails', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      tenantId: 't1',
      paymentMethod: 'CARD',
      totalAmount: 100,
      customerId: 'c1',
      lineItems: [{ skuId: 's1', warehouseId: 'w1', quantity: 1 }],
    })
    http.post
      .mockReturnValueOnce(of({ data: { reservationId: 'res1' } })) // reserve OK
      .mockReturnValueOnce(throwError(() => new Error('payment failed'))) // authorize FAILS
      .mockReturnValueOnce(of({ data: {} })) // release compensation

    await expect(saga.execute('o1', 't1', 'corr')).rejects.toThrow('payment failed')

    const updates = prisma.order.update.mock.calls.map((c: any[]) => c[0].data.status)
    expect(updates).toContain('FAILED')
    // release compensation should have been invoked
    const urls = http.post.mock.calls.map((c: any[]) => c[0])
    expect(urls.some((u: string) => u.includes('release'))).toBe(true)
  })

  it('marks order CONFIRMED on full success', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      tenantId: 't1',
      paymentMethod: 'NET_TERMS',
      totalAmount: 50,
      customerId: 'c1',
      lineItems: [{ skuId: 's1', warehouseId: 'w1', quantity: 2 }],
    })
    http.post
      .mockReturnValueOnce(of({ data: { reservationId: 'res1' } }))
      .mockReturnValueOnce(of({ data: {} })) // fulfillment
      .mockReturnValueOnce(of({ data: {} })) // tax

    await saga.execute('o1', 't1', 'corr')
    const updates = prisma.order.update.mock.calls.map((c: any[]) => c[0].data.status)
    expect(updates).toContain('CONFIRMED')
  })
})
