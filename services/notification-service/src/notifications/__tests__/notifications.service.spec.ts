import { NotificationsService } from '../notifications.service'

describe('NotificationsService', () => {
  it('enqueue returns existing row when idempotency key matches', async () => {
    const existing = { id: 'n1', tenantId: 't', idempotencyKey: 'k1' }
    const prisma = {
      notificationRequest: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
      },
    } as never
    const svc = new NotificationsService(prisma)
    const result = await svc.enqueue(
      't',
      {
        channel: 'EMAIL' as never,
        recipient: 'a@b.com',
        templateKey: 'welcome',
      },
      'k1',
    )
    expect(result).toBe(existing)
    expect((prisma as any).notificationRequest.create).not.toHaveBeenCalled()
  })
})
