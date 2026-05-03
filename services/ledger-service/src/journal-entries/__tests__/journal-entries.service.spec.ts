import { Prisma } from '../../generated/prisma-client'
import { assertJournalBalanced } from '../journalEntryBalance'

describe('assertJournalBalanced', () => {
  it('throws when debits != credits', () => {
    expect(() =>
      assertJournalBalanced([
        { debit: new Prisma.Decimal(10), credit: new Prisma.Decimal(0) },
        { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(5) },
      ]),
    ).toThrow(/balance/)
  })

  it('accepts balanced entry', () => {
    expect(() =>
      assertJournalBalanced([
        { debit: new Prisma.Decimal(10), credit: new Prisma.Decimal(0) },
        { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(10) },
      ]),
    ).not.toThrow()
  })
})
