import { UnauthorizedException } from '@nestjs/common'
import { QuoteStatus } from '../../generated/prisma-client'
import { PrismaService } from '../../prisma/prisma.service'
import { QuoteToOrderBridge } from '../quote-to-order.bridge'
import { QuotesService } from '../quotes.service'

describe('QuotesService', () => {
  it('submit requires Bearer token', async () => {
    const svc = new QuotesService({} as PrismaService, {} as QuoteToOrderBridge)
    await expect(svc.submit('tenant', 'q1')).rejects.toThrow(UnauthorizedException)
  })

  it('submit rejects non-OPEN', async () => {
    const bridge = { createOrderFromOpenQuote: jest.fn() }
    const prisma = {} as PrismaService
    const svc = new QuotesService(prisma, bridge as unknown as QuoteToOrderBridge)
    jest.spyOn(svc, 'get').mockResolvedValue({
      id: 'q1',
      status: QuoteStatus.SUBMITTED,
      tenantId: 't',
      customerRef: 'c',
      convertedOrderId: null,
      lines: [],
    } as never)
    await expect(svc.submit('t', 'q1', 'Bearer x')).rejects.toThrow(/OPEN/)
    expect(bridge.createOrderFromOpenQuote).not.toHaveBeenCalled()
  })

  it('submit idempotent when convertedOrderId exists', async () => {
    const bridge = { createOrderFromOpenQuote: jest.fn() }
    const prisma = {} as PrismaService
    const svc = new QuotesService(prisma, bridge as unknown as QuoteToOrderBridge)
    jest.spyOn(svc, 'get').mockResolvedValue({
      id: 'q1',
      status: QuoteStatus.SUBMITTED,
      tenantId: 't',
      customerRef: 'c',
      convertedOrderId: 'ord-existing',
      lines: [],
    } as never)
    await expect(svc.submit('t', 'q1', 'Bearer x')).resolves.toHaveProperty(
      'convertedOrderId',
      'ord-existing',
    )
    expect(bridge.createOrderFromOpenQuote).not.toHaveBeenCalled()
  })
})
