import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { StripeAdapter } from './stripe.adapter'
import { LedgerService } from './ledger.service'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { randomUUID } from 'crypto'
import { Decimal } from '../generated/prisma-client/runtime/library'

interface AuthorizeInput {
  orderId: string
  amount: number
  currency: string
  paymentMethod: string
  customerId: string
  paymentMethodId?: string
  correlationId: string
}

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private stripe: StripeAdapter,
    private ledger: LedgerService,
    private bus: EventBusClient,
  ) {}

  async authorize(tenantId: string, dto: AuthorizeInput) {
    const intent = await this.prisma.paymentIntent.create({
      data: {
        tenantId,
        orderId: dto.orderId,
        amount: new Decimal(dto.amount),
        currency: dto.currency,
        paymentMethod: dto.paymentMethod,
        customerId: dto.customerId,
        correlationId: dto.correlationId,
        status: 'PENDING',
      },
    })

    await this.bus.publish({
      id: randomUUID(),
      type: EventType.PAYMENT_INITIATED,
      tenantId,
      timestamp: new Date(),
      correlationId: dto.correlationId,
      version: 1,
      payload: { paymentIntentId: intent.id, orderId: dto.orderId, amount: dto.amount },
    })

    if (dto.paymentMethod === 'CASH' || dto.paymentMethod === 'CHECK') {
      const updated = await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'AUTHORIZED' },
      })
      return { paymentIntentId: updated.id, status: updated.status }
    }

    if (!dto.paymentMethodId) {
      throw new BadRequestException('paymentMethodId required for card/ACH payments')
    }

    const result =
      dto.paymentMethod === 'ACH'
        ? await this.stripe.processACH(dto.amount, dto.paymentMethodId, dto.customerId)
        : await this.stripe.authorize(dto.amount, dto.currency, dto.customerId, dto.paymentMethodId)

    if (!result.success) {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'FAILED', failureReason: result.error },
      })
      await this.bus.publish({
        id: randomUUID(),
        type: EventType.PAYMENT_FAILED,
        tenantId,
        timestamp: new Date(),
        correlationId: dto.correlationId,
        version: 1,
        payload: { paymentIntentId: intent.id, orderId: dto.orderId, error: result.error },
      })
      throw new BadRequestException(result.error ?? 'Payment authorization failed')
    }

    const updated = await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: 'AUTHORIZED', stripeIntentId: result.paymentIntentId },
    })

    return { paymentIntentId: updated.id, stripeIntentId: result.paymentIntentId, status: updated.status }
  }

  async capture(tenantId: string, paymentIntentId: string, correlationId: string) {
    const intent = await this.prisma.paymentIntent.findFirst({ where: { id: paymentIntentId, tenantId } })
    if (!intent) throw new NotFoundException('Payment intent not found')
    if (intent.status !== 'AUTHORIZED') throw new BadRequestException(`Cannot capture status ${intent.status}`)

    if (intent.stripeIntentId) {
      const r = await this.stripe.capture(intent.stripeIntentId)
      if (!r.success) throw new BadRequestException(r.error)
    }

    const updated = await this.prisma.paymentIntent.update({
      where: { id: paymentIntentId },
      data: { status: 'CAPTURED', capturedAmount: intent.amount },
    })

    await this.ledger.recordSale(tenantId, Number(intent.amount), 0, intent.orderId, correlationId)
    await this.bus.publish({
      id: randomUUID(),
      type: EventType.PAYMENT_CAPTURED,
      tenantId,
      timestamp: new Date(),
      correlationId,
      version: 1,
      payload: { paymentIntentId: intent.id, orderId: intent.orderId, amount: Number(intent.amount), currency: intent.currency },
    })

    return { paymentIntentId: updated.id, status: updated.status }
  }

  async voidIntent(tenantId: string, paymentIntentId: string, correlationId: string) {
    const intent = await this.prisma.paymentIntent.findFirst({ where: { id: paymentIntentId, tenantId } })
    if (!intent) throw new NotFoundException('Payment intent not found')
    if (intent.stripeIntentId) await this.stripe.void(intent.stripeIntentId)
    const updated = await this.prisma.paymentIntent.update({
      where: { id: paymentIntentId },
      data: { status: 'VOIDED' },
    })
    void correlationId
    return { paymentIntentId: updated.id, status: updated.status }
  }

  async refund(tenantId: string, paymentIntentId: string, amount: number | undefined, correlationId: string) {
    const intent = await this.prisma.paymentIntent.findFirst({ where: { id: paymentIntentId, tenantId } })
    if (!intent) throw new NotFoundException('Payment intent not found')
    if (intent.status !== 'CAPTURED') throw new BadRequestException(`Cannot refund status ${intent.status}`)

    if (intent.stripeIntentId) {
      const r = await this.stripe.refund(intent.stripeIntentId, amount)
      if (!r.success) throw new BadRequestException(r.error)
    }

    const refundAmount = amount ?? Number(intent.amount)
    const updated = await this.prisma.paymentIntent.update({
      where: { id: paymentIntentId },
      data: {
        refundedAmount: { increment: new Decimal(refundAmount) },
        status: refundAmount >= Number(intent.amount) ? 'REFUNDED' : 'CAPTURED',
      },
    })

    await this.ledger.recordRefund(tenantId, refundAmount, intent.orderId, correlationId)
    await this.bus.publish({
      id: randomUUID(),
      type: EventType.PAYMENT_REFUNDED,
      tenantId,
      timestamp: new Date(),
      correlationId,
      version: 1,
      payload: { paymentIntentId: intent.id, orderId: intent.orderId, amount: refundAmount },
    })

    return { paymentIntentId: updated.id, refundedAmount: Number(updated.refundedAmount), status: updated.status }
  }
}
