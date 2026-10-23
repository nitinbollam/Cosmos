import { AccountType } from '@/generated/prisma-ledger'
import { ledgerDb } from './db'
import { createChartAccount } from './ledger'

// Gift card journals are posted by the posting outbox (GIFT_CARD_ISSUE_JOURNAL / GIFT_CARD_REDEEM_JOURNAL).
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
