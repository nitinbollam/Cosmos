import { ExpenseReportStatus } from '@/generated/prisma-ledger'
import { GiftCardTxnType } from '@/generated/prisma-tenant'
import type { Prisma as PurchasingPrisma } from '@/generated/prisma-purchasing'
import type { Prisma as LedgerPrisma } from '@/generated/prisma-ledger'
import type { Prisma as TenantPrisma } from '@/generated/prisma-tenant'
import { ledgerDb, orderDb, purchasingDb, tenantDb } from './db'
import { toBaseDecimal } from './fx-util'
import { formatMoney } from './money'
import { enqueuePostingJob, postingDedupeKey, type EnqueueInput } from './posting-outbox'

/**
 * Postings whose source record lives outside the order database (vendor bills, expense reports,
 * gift card transactions). The job is queued after the source change commits, so it can be lost if
 * the order database is unreachable at that moment. Each job is built here from the source record
 * alone, so the request and the sweep below always produce the same key and amount, and the sweep
 * can re-queue anything that went missing.
 */

/** The PO receipt posting for a bill's current revision; the worker posts whatever brings the ledger to the bill's total. */
export function poReceiptJob(bill: {
  id: string
  tenantId: string
  totalAmount: PurchasingPrisma.Decimal
  fxRateToBase: PurchasingPrisma.Decimal
  receiptRevision: number
}): EnqueueInput {
  return {
    tenantId: bill.tenantId,
    kind: 'PO_RECEIPT_JOURNAL',
    sourceType: 'VendorBill',
    sourceId: bill.id,
    variant: `rev:${bill.receiptRevision}`,
    amount: toBaseDecimal(bill.totalAmount, bill.fxRateToBase).toString(),
  }
}

export function giftCardJob(
  tenantId: string,
  txn: { id: string; giftCardId: string; type: GiftCardTxnType; amount: TenantPrisma.Decimal },
): EnqueueInput {
  return {
    tenantId,
    kind: txn.type === GiftCardTxnType.ISSUE ? 'GIFT_CARD_ISSUE_JOURNAL' : 'GIFT_CARD_REDEEM_JOURNAL',
    sourceType: 'GiftCardTransaction',
    sourceId: txn.id,
    ref: txn.giftCardId,
    amount: txn.amount.toString(),
  }
}

type ReportForJob = { id: string; tenantId: string; totalAmount: LedgerPrisma.Decimal }

export function expenseApprovedJob(report: ReportForJob): EnqueueInput {
  return {
    tenantId: report.tenantId,
    kind: 'EXPENSE_APPROVAL_JOURNAL',
    sourceType: 'ExpenseReport',
    sourceId: report.id,
    variant: 'approved',
    amount: formatMoney(report.totalAmount),
  }
}

export function expensePaidJob(report: ReportForJob): EnqueueInput {
  return {
    tenantId: report.tenantId,
    kind: 'EXPENSE_PAID_JOURNAL',
    sourceType: 'ExpenseReport',
    sourceId: report.id,
    variant: 'paid',
    amount: formatMoney(report.totalAmount),
  }
}

export const SOURCE_SWEEP_LOOKBACK_MS = 48 * 3_600_000
/** Younger changes may still be queuing their own job. */
export const SOURCE_SWEEP_GRACE_MS = 15 * 60_000

/**
 * Re-queues postings missing for source changes made in the lookback window: bills whose current
 * revision has no job, approved or paid expense reports without their job, and gift card issues and
 * redemptions without a journal or a job. A job in any state (even DEAD) counts as present, so a
 * tenant without a chart of accounts is not re-queued over and over.
 */
export async function requeueMissingSourcePostings(
  opts: { now?: Date; tenantId?: string; lookbackMs?: number; graceMs?: number } = {},
) {
  const now = (opts.now ?? new Date()).getTime()
  const window = {
    gte: new Date(now - (opts.lookbackMs ?? SOURCE_SWEEP_LOOKBACK_MS)),
    lte: new Date(now - (opts.graceMs ?? SOURCE_SWEEP_GRACE_MS)),
  }
  const tenant = opts.tenantId ? { tenantId: opts.tenantId } : {}

  const [bills, approved, paid, txns] = await Promise.all([
    purchasingDb.vendorBill.findMany({
      where: { ...tenant, purchaseOrderId: { not: null }, status: { not: 'VOID' }, updatedAt: window },
      select: { id: true, tenantId: true, totalAmount: true, fxRateToBase: true, receiptRevision: true },
    }),
    ledgerDb.expenseReport.findMany({
      where: {
        ...tenant,
        status: { in: [ExpenseReportStatus.APPROVED, ExpenseReportStatus.PAID] },
        decidedAt: window,
        journalEntryId: null,
      },
      select: { id: true, tenantId: true, totalAmount: true },
    }),
    // Reports paid before paidAt existed have none, so they are never posted a second time.
    ledgerDb.expenseReport.findMany({
      where: { ...tenant, status: ExpenseReportStatus.PAID, paidAt: window },
      select: { id: true, tenantId: true, totalAmount: true },
    }),
    tenantDb.giftCardTransaction.findMany({
      where: {
        type: { in: [GiftCardTxnType.ISSUE, GiftCardTxnType.REDEEM] },
        journalEntryId: null,
        createdAt: window,
        ...(opts.tenantId ? { giftCard: { tenantId: opts.tenantId } } : {}),
      },
      select: { id: true, giftCardId: true, type: true, amount: true, giftCard: { select: { tenantId: true } } },
    }),
  ])

  const inputs = [
    ...bills.map(poReceiptJob),
    ...approved.map(expenseApprovedJob),
    ...paid.map(expensePaidJob),
    ...txns.map((t) => giftCardJob(t.giftCard.tenantId, t)),
  ].filter((i) => Number(i.amount) > 0)

  const present = new Set<string>()
  for (let i = 0; i < inputs.length; i += 500) {
    const rows = await orderDb.postingJob.findMany({
      where: { dedupeKey: { in: inputs.slice(i, i + 500).map(postingDedupeKey) } },
      select: { dedupeKey: true },
    })
    for (const r of rows) present.add(r.dedupeKey)
  }

  let requeued = 0
  for (const input of inputs) {
    if (present.has(postingDedupeKey(input))) continue
    await enqueuePostingJob(orderDb, input)
    requeued++
    console.warn(`[gl] re-queued missing ${input.kind} for ${input.sourceType} ${input.sourceId} (tenant=${input.tenantId})`)
  }
  if (requeued > 0) console.warn(`[metric] posting_requeued ${requeued}`)
  return { checked: inputs.length, requeued }
}
