import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { randomUUID } from 'crypto'
import { Decimal } from '../generated/prisma-client/runtime/library'

@Injectable()
export class LedgerService {
  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusClient,
  ) {}

  async recordSale(
    tenantId: string,
    amount: number,
    taxAmount: number,
    orderId: string,
    correlationId: string,
  ): Promise<void> {
    const entryGroupId = randomUUID()

    await this.prisma.$transaction([
      this.prisma.ledgerEntry.create({
        data: {
          tenantId, entryGroupId,
          accountCode: '1100', accountType: 'ASSET',
          debit: new Decimal(amount + taxAmount), credit: new Decimal(0),
          description: `Sale - Order ${orderId}`,
          referenceId: orderId, referenceType: 'ORDER', correlationId,
        },
      }),
      this.prisma.ledgerEntry.create({
        data: {
          tenantId, entryGroupId,
          accountCode: '4000', accountType: 'REVENUE',
          debit: new Decimal(0), credit: new Decimal(amount),
          description: `Revenue - Order ${orderId}`,
          referenceId: orderId, referenceType: 'ORDER', correlationId,
        },
      }),
      this.prisma.ledgerEntry.create({
        data: {
          tenantId, entryGroupId,
          accountCode: '2200', accountType: 'LIABILITY',
          debit: new Decimal(0), credit: new Decimal(taxAmount),
          description: `Sales Tax - Order ${orderId}`,
          referenceId: orderId, referenceType: 'ORDER', correlationId,
        },
      }),
    ])

    await this.eventBus.publish({
      id: randomUUID(),
      type: EventType.LEDGER_ENTRY_CREATED,
      tenantId,
      timestamp: new Date(),
      correlationId,
      version: 1,
      payload: { entryGroupId, orderId, amount, taxAmount },
    })
  }

  async recordRefund(tenantId: string, amount: number, orderId: string, correlationId: string): Promise<void> {
    const entryGroupId = randomUUID()
    await this.prisma.$transaction([
      this.prisma.ledgerEntry.create({
        data: {
          tenantId, entryGroupId,
          accountCode: '4000', accountType: 'REVENUE',
          debit: new Decimal(amount), credit: new Decimal(0),
          description: `Refund (revenue reversal) - ${orderId}`,
          referenceId: orderId, referenceType: 'REFUND', correlationId,
        },
      }),
      this.prisma.ledgerEntry.create({
        data: {
          tenantId, entryGroupId,
          accountCode: '1100', accountType: 'ASSET',
          debit: new Decimal(0), credit: new Decimal(amount),
          description: `Refund (AR reduction) - ${orderId}`,
          referenceId: orderId, referenceType: 'REFUND', correlationId,
        },
      }),
    ])
  }
}
