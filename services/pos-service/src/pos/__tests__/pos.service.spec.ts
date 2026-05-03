import { PosService } from '../pos.service'

describe('PosService', () => {
  it('openShift rejects when shift already open', async () => {
    const prisma = {
      posRegister: { findFirst: jest.fn().mockResolvedValue({ id: 'r1' }) },
      posShift: {
        findFirst: jest.fn().mockResolvedValue({ id: 'open' }),
      },
    } as never
    const svc = new PosService(prisma)
    await expect(
      svc.openShift('t', {
        registerId: 'r1',
        openingCash: 100,
        openedBy: 'u1',
      }),
    ).rejects.toThrow(/already open/)
  })
})
