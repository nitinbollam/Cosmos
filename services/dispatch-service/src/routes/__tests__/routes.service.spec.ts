import { RoutesService } from '../routes.service'

describe('RoutesService', () => {
  it('markStopDelivered marks stop and completes route when all delivered', async () => {
    const finalRoute = {
      id: 'r1',
      tenantId: 't',
      stops: [{ id: 's1', status: 'DELIVERED' }],
    }
    const prisma = {
      deliveryRoute: {
        findFirst: jest.fn().mockResolvedValue(finalRoute),
        update: jest.fn(),
      },
      routeStop: {
        findFirst: jest.fn().mockResolvedValue({ id: 's1', routeId: 'r1' }),
        findMany: jest.fn().mockResolvedValue([{ id: 's1', status: 'DELIVERED' }]),
        update: jest.fn(),
      },
    } as never
    const svc = new RoutesService(prisma)
    const result = await svc.markStopDelivered('t', 'r1', 's1')
    expect(result.id).toBe('r1')
    expect((prisma as any).routeStop.update).toHaveBeenCalled()
    expect((prisma as any).deliveryRoute.update).toHaveBeenCalled()
  })
})
