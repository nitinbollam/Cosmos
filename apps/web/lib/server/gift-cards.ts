import { randomBytes } from 'node:crypto'
import { Prisma, GiftCardTxnType } from '@/generated/prisma-tenant'
import { tenantDb } from './db'
import { ApiError } from './session'
import { postGiftCardIssueJournal, postGiftCardRedeemJournal } from './gift-card-gl'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

function generateGiftCardCode(): string {
  const group = () =>
    Array.from({ length: 4 }, () => CODE_CHARS[randomBytes(1)[0]! % CODE_CHARS.length]).join('')
  return `${group()}-${group()}-${group()}-${group()}`
}

async function uniqueCode(tenantId: string): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateGiftCardCode()
    const exists = await tenantDb.giftCard.findFirst({ where: { tenantId, code } })
    if (!exists) return code
  }
  throw new ApiError(500, 'Could not generate unique gift card code')
}

function cardExpired(card: { expiresAt: Date | null; isActive: boolean }): boolean {
  if (!card.isActive) return true
  if (card.expiresAt && card.expiresAt.getTime() < Date.now()) return true
  return false
}

export async function issueGiftCard(
  tenantId: string,
  input: { amount: number; issuedToCustomerId?: string; expiresAt?: string },
) {
  if (input.amount <= 0) throw new ApiError(400, 'Gift card amount must be positive')

  const code = await uniqueCode(tenantId)
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new ApiError(400, 'Invalid expiresAt')

  return tenantDb.$transaction(async (tx) => {
    const card = await tx.giftCard.create({
      data: {
        tenantId,
        code,
        initialBalance: new Prisma.Decimal(input.amount),
        currentBalance: new Prisma.Decimal(input.amount),
        issuedToCustomerId: input.issuedToCustomerId ?? null,
        expiresAt,
      },
    })

    const journalEntryId = await postGiftCardIssueJournal(tenantId, card.id, input.amount)
    await tx.giftCardTransaction.create({
      data: {
        giftCardId: card.id,
        type: GiftCardTxnType.ISSUE,
        amount: new Prisma.Decimal(input.amount),
        journalEntryId,
      },
    })

    return card
  })
}

export async function getGiftCardByCode(tenantId: string, code: string) {
  const normalized = normalizeCode(code)
  const card = await tenantDb.giftCard.findFirst({ where: { tenantId, code: normalized } })
  if (!card) throw new ApiError(404, 'Gift card not found')
  return card
}

export async function checkGiftCardBalance(tenantId: string, code: string) {
  const normalized = normalizeCode(code)
  const card = await tenantDb.giftCard.findFirst({ where: { tenantId, code: normalized } })
  if (!card) return { valid: false as const }
  const expired = cardExpired(card)
  const balance = Number(card.currentBalance)
  if (expired || balance <= 0) {
    return { valid: false as const, expired, balance: 0 }
  }
  return { valid: true as const, balance, expired: false }
}

export async function redeemGiftCard(
  tenantId: string,
  code: string,
  input: { amount: number; orderRef: string },
) {
  if (input.amount <= 0) throw new ApiError(400, 'Redemption amount must be positive')

  return tenantDb.$transaction(async (tx) => {
    const normalized = normalizeCode(code)
    const card = await tx.giftCard.findFirst({ where: { tenantId, code: normalized } })
    if (!card) throw new ApiError(404, 'Gift card not found')
    if (cardExpired(card)) throw new ApiError(400, 'Gift card is inactive or expired')

    const balance = Number(card.currentBalance)
    if (balance <= 0) throw new ApiError(400, 'Gift card has no remaining balance')

    const amountApplied = +Math.min(input.amount, balance).toFixed(2)
    const remainingBalance = +(balance - amountApplied).toFixed(2)

    const journalEntryId = await postGiftCardRedeemJournal(tenantId, card.id, amountApplied)
    await tx.giftCardTransaction.create({
      data: {
        giftCardId: card.id,
        type: GiftCardTxnType.REDEEM,
        amount: new Prisma.Decimal(amountApplied),
        orderRef: input.orderRef,
        journalEntryId,
      },
    })

    await tx.giftCard.update({
      where: { id: card.id },
      data: { currentBalance: new Prisma.Decimal(remainingBalance) },
    })

    return { amountApplied, remainingBalance }
  })
}

export async function listGiftCards(tenantId: string) {
  return tenantDb.giftCard.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
}

export async function getGiftCardDetail(tenantId: string, code: string) {
  const card = await getGiftCardByCode(tenantId, code)
  const transactions = await tenantDb.giftCardTransaction.findMany({
    where: { giftCardId: card.id },
    orderBy: { createdAt: 'desc' },
  })
  return { card, transactions }
}
