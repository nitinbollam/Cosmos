import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async trialBalance(tenantId: string, year: number, month: number) {
    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 0, 23, 59, 59, 999)

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        tenantId,
        isPosted: true,
        postedAt: { gte: start, lte: end },
      },
      include: { lines: { include: { account: true } } },
    })

    const map = new Map<
      string,
      { accountCode: string; accountName: string; type: string; debits: number; credits: number }
    >()

    for (const e of entries) {
      for (const l of e.lines) {
        const a = l.account
        if (!map.has(a.id)) {
          map.set(a.id, {
            accountCode: a.code,
            accountName: a.name,
            type: a.type,
            debits: 0,
            credits: 0,
          })
        }
        const row = map.get(a.id)!
        row.debits += Number(l.debit)
        row.credits += Number(l.credit)
      }
    }

    return [...map.values()]
      .sort((x, y) => x.accountCode.localeCompare(y.accountCode))
      .map((r) => ({
        ...r,
        netBalance: r.debits - r.credits,
      }))
  }
}
