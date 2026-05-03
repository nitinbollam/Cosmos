import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { Prisma, QuoteStatus } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateQuoteDto } from './dto/create-quote.dto'
import { QuoteToOrderBridge } from './quote-to-order.bridge'

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quoteToOrder: QuoteToOrderBridge,
  ) {}

  list(tenantId: string, status?: QuoteStatus) {
    return this.prisma.b2BQuote.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.b2BQuote.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    })
    if (!row) throw new NotFoundException('Quote not found')
    return row
  }

  async create(tenantId: string, dto: CreateQuoteDto) {
    const seqs = new Set(dto.lines.map((l) => l.lineNo))
    if (seqs.size !== dto.lines.length) throw new BadRequestException('Duplicate line numbers')
    return this.prisma.b2BQuote.create({
      data: {
        tenantId,
        customerRef: dto.customerRef,
        notes: dto.notes,
        status: QuoteStatus.OPEN,
        lines: {
          create: dto.lines.map((l) => ({
            lineNo: l.lineNo,
            skuCode: l.skuCode,
            description: l.description,
            qty: l.qty,
            unitPrice: new Prisma.Decimal(l.unitPrice),
          })),
        },
      },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    })
  }

  /**
   * Idempotent replay: quotes already linked to **`convertedOrderId`** return as-is even if SUBMITTED.
   * Requires **Bearer** JWT the gateway would accept on inventory/crm/order.
   */
  async submit(tenantId: string, id: string, authorizationRaw?: string | string[]) {
    const authorization =
      typeof authorizationRaw === 'string'
        ? authorizationRaw
        : Array.isArray(authorizationRaw)
          ? authorizationRaw[0]
          : undefined

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization bearer token required for quote submission')
    }

    const q = await this.get(tenantId, id)

    if (q.convertedOrderId) {
      return this.get(tenantId, id)
    }

    if (q.status !== QuoteStatus.OPEN) {
      throw new BadRequestException('Only OPEN quotes can be submitted')
    }

    const orderId = await this.quoteToOrder.createOrderFromOpenQuote(q, authorization)

    return this.prisma.b2BQuote.update({
      where: { id },
      data: { status: QuoteStatus.SUBMITTED, convertedOrderId: orderId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    })
  }
}
