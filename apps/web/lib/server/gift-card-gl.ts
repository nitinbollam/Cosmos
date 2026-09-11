import { AccountType, Prisma } from '@/generated/prisma-ledger'
import { ledgerDb } from './db'
import { createChartAccount } from './ledger'

const CASH_CODE = '1000'
const REV_CODE = '4000'
const GIFT_CARD_LIABILITY_CODE = '2150'

async function accountByCode(tenantId: string, code: string) {
  return ledgerDb.chartAccount.findFirst({ where: { tenantId, code, isActive: true } })
}

export async function ensureGiftCardLiabilityAccount(tenantId: string) {
  const existing = await accountByCode(tenantId, GIFT_CARD_LIABILITY_CODE)
  if (existing) return existing
  try {
    return await createChartAccount(tenantId, {
      code: GIFT_CARD_LIABILITY_CODE,
      name: 'Gift Card Liability',
      type: AccountType.LIABILITY,
    })
  } catch {
    const retry = await accountByCode(tenantId, GIFT_CARD_LIABILITY_CODE)
    if (retry) return retry
    throw new Error('Could not create Gift Card Liability account')
  }
}

async function requireAccounts(tenantId: string, codes: string[]) {
  const rows = await ledgerDb.chartAccount.findMany({
    where: { tenantId, code: { in: codes }, isActive: true },
  })
  const map = new Map(rows.map((r) => [r.code, r]))
  for (const code of codes) {
    if (!map.has(code)) return null
  }
  return map
}

export async function postGiftCardIssueJournal(tenantId: string, giftCardId: string, amount: number) {
  if (amount <= 0) return null
  await ensureGiftCardLiabilityAccount(tenantId)
  const accts = await requireAccounts(tenantId, [CASH_CODE, GIFT_CARD_LIABILITY_CODE])
  if (!accts) return null

  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: `Gift card issued ${giftCardId.slice(-8)}`,
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: accts.get(CASH_CODE)!.id,
            memo: 'Cash received for gift card',
            debit: new Prisma.Decimal(amount),
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: accts.get(GIFT_CARD_LIABILITY_CODE)!.id,
            memo: 'Gift card liability',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(amount),
          },
        ],
      },
    },
  })
  return entry.id
}

export async function postGiftCardRedeemJournal(tenantId: string, giftCardId: string, amount: number) {
  if (amount <= 0) return null
  await ensureGiftCardLiabilityAccount(tenantId)
  const accts = await requireAccounts(tenantId, [GIFT_CARD_LIABILITY_CODE, REV_CODE])
  if (!accts) return null

  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: `Gift card redeemed ${giftCardId.slice(-8)}`,
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: accts.get(GIFT_CARD_LIABILITY_CODE)!.id,
            memo: 'Gift card liability reduction',
            debit: new Prisma.Decimal(amount),
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: accts.get(REV_CODE)!.id,
            memo: 'Gift card revenue recognition',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(amount),
          },
        ],
      },
    },
  })
  return entry.id
}
