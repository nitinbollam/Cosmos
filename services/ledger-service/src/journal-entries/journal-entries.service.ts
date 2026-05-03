import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto'
import { toDecimal } from './dto/journal-line-input.dto'
import { assertJournalBalanced } from './journalEntryBalance'

export { assertJournalBalanced } from './journalEntryBalance'

@Injectable()
export class JournalEntriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.journalEntry.findMany({
      where: { tenantId },
      include: { lines: { include: { account: true } } },
      orderBy: { postedAt: 'desc' },
    })
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.journalEntry.findFirst({
      where: { id, tenantId },
      include: { lines: { include: { account: true } } },
    })
    if (!row) throw new NotFoundException('Journal entry not found')
    return row
  }

  async createDraft(tenantId: string, dto: CreateJournalEntryDto) {
    const decLines = dto.lines.map((l) => ({
      accountId: l.accountId,
      memo: l.memo,
      debit: toDecimal(l.debit),
      credit: toDecimal(l.credit),
    }))
    assertJournalBalanced(decLines)

    const accountIds = [...new Set(dto.lines.map((l) => l.accountId))]
    const accounts = await this.prisma.chartAccount.findMany({
      where: { tenantId, id: { in: accountIds } },
    })
    if (accounts.length !== accountIds.length) {
      throw new BadRequestException('One or more accounts are invalid for this tenant')
    }

    return this.prisma.journalEntry.create({
      data: {
        tenantId,
        description: dto.description,
        fiscalPeriodClosed: dto.fiscalPeriodClosed ?? false,
        isPosted: false,
        lines: {
          create: decLines.map((l) => ({
            accountId: l.accountId,
            memo: l.memo,
            debit: l.debit,
            credit: l.credit,
          })),
        },
      },
      include: { lines: { include: { account: true } } },
    })
  }

  async post(tenantId: string, id: string) {
    const entry = await this.get(tenantId, id)
    if (entry.isPosted) throw new BadRequestException('Already posted')
    assertJournalBalanced(entry.lines.map((l) => ({ debit: l.debit, credit: l.credit })))
    return this.prisma.journalEntry.update({
      where: { id },
      data: { isPosted: true },
      include: { lines: { include: { account: true } } },
    })
  }
}
