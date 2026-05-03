import { BadRequestException } from '@nestjs/common'
import { Prisma } from '../generated/prisma-client'

export function assertJournalBalanced(
  lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[],
): void {
  let deb = new Prisma.Decimal(0)
  let cred = new Prisma.Decimal(0)
  for (const l of lines) {
    if (l.debit.gt(0) && l.credit.gt(0)) {
      throw new BadRequestException('Line cannot have both debit and credit')
    }
    deb = deb.plus(l.debit)
    cred = cred.plus(l.credit)
  }
  if (!deb.equals(cred)) throw new BadRequestException('Journal entry must balance (debits = credits)')
}
