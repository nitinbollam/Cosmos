import { ConflictException } from '@nestjs/common'
import { TenantsService } from '../tenants.service'

describe('TenantsService', () => {
  it('refuses duplicate provision', async () => {
    const prisma = {
      tenantOrganization: {
        findFirst: jest.fn().mockResolvedValue({ id: 't1' }),
      },
    } as never
    const svc = new TenantsService(prisma)
    await expect(
      svc.provision({ id: 't1', slug: 'acme', displayName: 'Acme' }),
    ).rejects.toBeInstanceOf(ConflictException)
  })
})
