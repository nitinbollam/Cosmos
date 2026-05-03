import { Body, Controller, Get, Post, Req } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { randomUUID } from 'crypto'

interface RecordTaxBody {
  orderId: string
  customerId: string
  lineItems: Array<{ skuId: string; quantity: number; unitPrice: number; warehouseId: string }>
  correlationId: string
}

@Controller('tax')
export class TaxController {
  constructor(
    private prisma: PrismaService,
    private bus: EventBusClient,
  ) {}

  @Post('record')
  async record(@Req() req: { user: { tenantId: string } }, @Body() body: RecordTaxBody) {
    const tenantId = req.user.tenantId
    const total = body.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0)
    const taxAmount = +(total * 0.07).toFixed(2)

    await this.bus.publish({
      id: randomUUID(),
      type: EventType.TAX_LIABILITY_RECORDED,
      tenantId,
      timestamp: new Date(),
      correlationId: body.correlationId,
      version: 1,
      payload: { orderId: body.orderId, taxAmount, lineItems: body.lineItems.length },
    })

    return { recorded: true, taxAmount }
  }

  @Get('summary')
  async summary(@Req() req: { user: { tenantId: string } }) {
    const liabilities = await this.prisma.mSATransaction.aggregate({
      where: { tenantId: req.user.tenantId },
      _sum: { netAmount: true },
      _count: true,
    })
    return { totalNet: liabilities._sum.netAmount ?? 0, count: liabilities._count }
  }
}
