import { Prisma } from '@/generated/prisma-ledger'
import { ledgerDb } from './db'

const CASH_CODE = '1000'
const AR_CODE = '1200'
const INV_CODE = '1100'
const AP_CODE = '2100'
const COGS_CODE = '5000'

async function accountsByCodes(tenantId: string, codes: string[]) {
  const rows = await ledgerDb.chartAccount.findMany({
    where: { tenantId, code: { in: codes }, isActive: true },
  })
  const map = new Map(rows.map((r) => [r.code, r]))
  for (const code of codes) {
    if (!map.has(code)) return null
  }
  return map
}

export async function postArPaymentJournal(tenantId: string, refId: string, amount: number) {
  if (amount <= 0) return null
  const accts = await accountsByCodes(tenantId, [CASH_CODE, AR_CODE])
  if (!accts) return null

  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: `AR payment ${refId.slice(-8)}`,
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: accts.get(CASH_CODE)!.id,
            memo: 'Cash received',
            debit: new Prisma.Decimal(amount),
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: accts.get(AR_CODE)!.id,
            memo: 'Accounts receivable reduction',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(amount),
          },
        ],
      },
    },
  })
  return entry.id
}

/** Refund to customer: Dr AR (restore) / Cr Cash. Pairs with the credit memo journal. */
export async function postArRefundJournal(tenantId: string, refId: string, amount: number) {
  if (amount <= 0) return null
  const accts = await accountsByCodes(tenantId, [CASH_CODE, AR_CODE])
  if (!accts) return null

  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: `Customer refund ${refId.slice(-8)}`,
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: accts.get(AR_CODE)!.id,
            memo: 'Accounts receivable restored',
            debit: new Prisma.Decimal(amount),
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: accts.get(CASH_CODE)!.id,
            memo: 'Cash refunded',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(amount),
          },
        ],
      },
    },
  })
  return entry.id
}

export async function postPoReceiptJournal(tenantId: string, refId: string, amount: number) {
  if (amount <= 0) return null
  const accts = await accountsByCodes(tenantId, [INV_CODE, AP_CODE])
  if (!accts) return null

  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: `PO receipt ${refId.slice(-8)} — inventory accrual`,
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: accts.get(INV_CODE)!.id,
            memo: 'Inventory received',
            debit: new Prisma.Decimal(amount),
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: accts.get(AP_CODE)!.id,
            memo: 'Accounts payable',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(amount),
          },
        ],
      },
    },
  })
  return entry.id
}

export async function postApPaymentJournal(tenantId: string, refId: string, amount: number) {
  if (amount <= 0) return null
  const accts = await accountsByCodes(tenantId, [AP_CODE, CASH_CODE])
  if (!accts) return null

  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: `AP payment ${refId.slice(-8)}`,
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: accts.get(AP_CODE)!.id,
            memo: 'Accounts payable reduction',
            debit: new Prisma.Decimal(amount),
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: accts.get(CASH_CODE)!.id,
            memo: 'Cash paid',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(amount),
          },
        ],
      },
    },
  })
  return entry.id
}

/** Dr COGS / Cr Inventory when order ships. */
export async function postCogsJournal(tenantId: string, refId: string, cogsAmount: number) {
  if (cogsAmount <= 0) return null
  const accts = await accountsByCodes(tenantId, [COGS_CODE, INV_CODE])
  if (!accts) return null

  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: `COGS on ship ${refId.slice(-8)}`,
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: accts.get(COGS_CODE)!.id,
            memo: 'Cost of goods sold',
            debit: new Prisma.Decimal(cogsAmount),
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: accts.get(INV_CODE)!.id,
            memo: 'Inventory reduction',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(cogsAmount),
          },
        ],
      },
    },
  })
  return entry.id
}

/** Restocked return: Dr Inventory / Cr COGS — reverses the ship-time COGS for returned units. */
export async function postCogsReversalJournal(tenantId: string, refId: string, cogsAmount: number) {
  if (cogsAmount <= 0) return null
  const accts = await accountsByCodes(tenantId, [COGS_CODE, INV_CODE])
  if (!accts) return null

  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: `COGS reversal on return ${refId.slice(-8)}`,
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: accts.get(INV_CODE)!.id,
            memo: 'Inventory restored',
            debit: new Prisma.Decimal(cogsAmount),
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: accts.get(COGS_CODE)!.id,
            memo: 'Cost of goods sold reversal',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(cogsAmount),
          },
        ],
      },
    },
  })
  return entry.id
}

export async function computeOrderCogs(tenantId: string, lineItems: Array<{ skuId: string; quantity: number }>) {
  const { inventoryDb } = await import('./db')
  const skuIds = [...new Set(lineItems.map((l) => l.skuId))]
  const skus = await inventoryDb.sKU.findMany({
    where: { tenantId, id: { in: skuIds } },
    select: { id: true, cost: true },
  })
  const costMap = new Map(skus.map((s) => [s.id, Number(s.cost)]))
  return +lineItems.reduce((sum, li) => sum + li.quantity * (costMap.get(li.skuId) ?? 0), 0).toFixed(2)
}

export async function ensureTier5Accounts(tenantId: string) {
  const defaults = [
    { code: INV_CODE, name: 'Inventory', type: 'ASSET' as const },
    { code: AP_CODE, name: 'Accounts Payable', type: 'LIABILITY' as const },
    { code: COGS_CODE, name: 'Cost of Goods Sold', type: 'EXPENSE' as const },
  ]
  for (const acct of defaults) {
    await ledgerDb.chartAccount.upsert({
      where: { tenantId_code: { tenantId, code: acct.code } },
      create: { tenantId, code: acct.code, name: acct.name, type: acct.type, isActive: true },
      update: {},
    })
  }
}
