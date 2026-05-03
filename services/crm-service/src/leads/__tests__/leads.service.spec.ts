import { LeadStatus } from '../../generated/prisma-client'
import { LeadsService } from '../leads.service'

describe('LeadsService', () => {
  it('convert rejects non-OPEN lead', async () => {
    const prisma = {} as never
    const svc = new LeadsService(prisma)
    const get = jest.spyOn(svc, 'get').mockResolvedValue({
      id: 'l1',
      tenantId: 't',
      status: LeadStatus.CONVERTED,
    } as never)
    await expect(svc.convert('t', 'l1', { customerName: 'Acme' })).rejects.toThrow(/OPEN/)
    get.mockRestore()
  })
})
