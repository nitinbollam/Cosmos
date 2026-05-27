import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-ledger'
import { ledgerDb } from './db'

const AR_CODE = '1200'
const REV_CODE = '4000'

async function accountsByCode(tenantId: string) {
  const rows = await ledgerDb.chartAccount.findMany({
    where: { tenantId, code: { in: [AR_CODE, REV_CODE] }, isActive: true },
  })
  const ar = rows.find((r) => r.code === AR_CODE)
  const rev = rows.find((r) => r.code === REV_CODE)
  if (!ar || !rev) return null
  return { ar, rev }
}

export async function postInvoiceJournal(tenantId: string, invoiceId: string, totalAmount: number) {
  if (totalAmount <= 0) return null
  const accts = await accountsByCode(tenantId)
  if (!accts) return null

  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: `Invoice ${invoiceId.slice(-8)} — AR recognition`,
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: accts.ar.id,
            memo: 'Accounts receivable',
            debit: new Prisma.Decimal(totalAmount),
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: accts.rev.id,
            memo: 'Sales revenue',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(totalAmount),
          },
        ],
      },
    },
  })
  return entry.id
}

export async function postCreditMemoJournal(tenantId: string, creditMemoId: string, totalAmount: number) {
  if (totalAmount <= 0) return null
  const accts = await accountsByCode(tenantId)
  if (!accts) return null

  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: `Credit memo ${creditMemoId.slice(-8)} — AR reversal`,
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: accts.rev.id,
            memo: 'Sales revenue reversal',
            debit: new Prisma.Decimal(totalAmount),
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: accts.ar.id,
            memo: 'Accounts receivable reduction',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(totalAmount),
          },
        ],
      },
    },
  })
  return entry.id
}
