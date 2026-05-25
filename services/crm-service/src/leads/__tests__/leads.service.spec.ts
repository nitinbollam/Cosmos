import { LeadsService } from '../leads.service'

describe('LeadsService', () => {
  it('convert rejects closed (WON) lead', async () => {
    const prisma = {} as never
    const svc = new LeadsService(prisma)
    const get = jest.spyOn(svc, 'get').mockResolvedValue({
      id: 'l1',
      tenantId: 't',
      status: 'WON',
      customerId: null,
    } as never)
    await expect(svc.convert('t', 'l1', { customerName: 'Acme' })).rejects.toThrow(/closed/)
    get.mockRestore()
  })
})
