import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-ledger'
import type { Prisma as OrderPrisma } from '@/generated/prisma-order'
import { ledgerDb, orderDb, purchasingDb, tenantDb } from './db'
import { ApiError } from './session'
import { createJournalOnce, requireAccounts, requireSalesTaxPayable } from './ledger-posting'
import { isWorkKind, runWork, type WorkKind } from './deferred-work'
import { ensureExpenseAccounts } from './expense-gl'
import { ensureGiftCardLiabilityAccount } from './gift-card-gl'

/**
 * Transactional outbox for general-ledger postings.
 *
 * The business change and the intent to post commit together in the order database
 * (`enqueuePostingJob(tx, ...)`). A worker then posts to the ledger database asynchronously,
 * retrying with backoff, so a ledger outage never loses a posting and never blocks shipping.
 * The ledger side is idempotent (unique source key on JournalEntry), so a replay cannot post twice.
 */

export type PostingJobKind =
  | 'INVOICE_JOURNAL'
  | 'INVOICE_EXTENSION_JOURNAL'
  | 'COGS_JOURNAL'
  | 'COGS_REVERSAL_JOURNAL'
  | 'CREDIT_MEMO_JOURNAL'
  | 'AR_PAYMENT_JOURNAL'
  | 'AP_PAYMENT_JOURNAL'
  | 'PO_RECEIPT_JOURNAL'
  | 'EXPENSE_APPROVAL_JOURNAL'
  | 'EXPENSE_PAID_JOURNAL'
  | 'GIFT_CARD_ISSUE_JOURNAL'
  | 'GIFT_CARD_REDEEM_JOURNAL'
  | WorkKind

export const MAX_POSTING_ATTEMPTS = 8
/** Delay after failed attempt 1..5; later attempts reuse the last value. */
export const POSTING_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000]
const LEASE_MS = 2 * 60_000

type OrderTx = OrderPrisma.TransactionClient | typeof orderDb

export function postingBackoffMs(failedAttempts: number): number {
  return POSTING_BACKOFF_MS[Math.min(failedAttempts, POSTING_BACKOFF_MS.length) - 1]
}

export type EnqueueInput = {
  tenantId: string
  kind: PostingJobKind
  sourceType: string
  sourceId: string
  /** Distinguishes several postings for one source (for example a follow-up shipment). */
  variant?: string
  /** Decimal amount as a string, in the tenant's base currency. */
  amount: string
  /**
   * The part of `amount` that is sales tax, in base currency. Posted to Sales Tax Payable instead of
   * revenue. Omitted on jobs queued before tax was split out; those post the whole amount to revenue.
   */
  taxAmount?: string
  /** Id shown in the journal description when it differs from `sourceId` (the gift card for a card transaction). */
  ref?: string
}

export function postingDedupeKey(i: Pick<EnqueueInput, 'tenantId' | 'kind' | 'sourceType' | 'sourceId' | 'variant'>) {
  return `${i.tenantId}:${i.kind}:${i.sourceType}:${i.sourceId}:${i.variant ?? ''}`
}

/** Idempotent: enqueueing the same posting twice leaves one job. Pass the transaction client. */
export async function enqueuePostingJob(tx: OrderTx, input: EnqueueInput) {
  if (!(Number(input.amount) > 0)) return null
  const dedupeKey = postingDedupeKey(input)
  return tx.postingJob.upsert({
    where: { dedupeKey, tenantId: input.tenantId },
    update: {},
    create: {
      id: randomUUID(),
      tenantId: input.tenantId,
      kind: input.kind,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      variant: input.variant ?? '',
      dedupeKey,
      payload: {
        amount: input.amount,
        ...(input.taxAmount && Number(input.taxAmount) > 0 ? { taxAmount: input.taxAmount } : {}),
        ...(input.ref ? { ref: input.ref } : {}),
      },
    },
  })
}

/**
 * Queues a posting for a change already committed in another database (purchasing, ledger, tenant),
 * where the job cannot share the transaction. The change has happened, so a failure here must not
 * fail the request (a retry would repeat it); it is logged with its source key and counted instead,
 * so the missing journal can be found and queued by hand.
 */
export async function enqueuePostingJobAfterCommit(input: EnqueueInput) {
  try {
    return await enqueuePostingJob(orderDb, input)
  } catch (err) {
    console.error(
      `[gl] could not queue ${input.kind} for ${input.sourceType} ${input.sourceId} (tenant=${input.tenantId}, amount=${input.amount}); the journal is missing until it is queued:`,
      err,
    )
    console.error(`[metric] posting_enqueue_failed 1 kind=${input.kind}`)
    return null
  }
}

type JobRow = {
  id: string
  tenantId: string
  kind: PostingJobKind
  sourceType: string
  sourceId: string
  variant: string
  payload: unknown
}

const dec = (v: string) => new Prisma.Decimal(v)
const ZERO = new Prisma.Decimal(0)

/** The tax part of a job's amount, never more than the amount itself. */
function taxOf(job: JobRow, total: Prisma.Decimal): Prisma.Decimal {
  const raw = (job.payload as { taxAmount?: string })?.taxAmount
  if (!raw || !(Number(raw) > 0)) return ZERO
  const tax = dec(raw)
  return tax.gt(total) ? total : tax
}

/**
 * Runs one job. Ledger kinds post to the ledger and return the journal entry id; work kinds
 * (invoice sync, credit release and the like) redo a side effect that failed inline and return null.
 * Throws on any failure so the worker retries.
 */
export async function postJob(job: JobRow): Promise<string | null> {
  if (isWorkKind(job.kind)) {
    await runWork({ tenantId: job.tenantId, kind: job.kind, sourceType: job.sourceType, sourceId: job.sourceId, payload: job.payload as Record<string, unknown> | undefined })
    return null
  }
  const amount = String((job.payload as { amount?: string })?.amount ?? '')
  if (!(Number(amount) > 0)) throw new Error(`Posting job ${job.id} has no positive amount`)
  const source = { sourceType: job.sourceType, sourceId: job.sourceId, variant: job.variant }
  const short = job.sourceId.slice(-8)
  const refShort = String((job.payload as { ref?: string })?.ref ?? job.sourceId).slice(-8)

  switch (job.kind) {
    case 'INVOICE_JOURNAL':
    case 'INVOICE_EXTENSION_JOURNAL': {
      const a = await requireAccounts(job.tenantId, ['1200', '4000'])
      const total = dec(amount)
      const tax = taxOf(job, total)
      const lines = [
        { accountId: a.get('1200')!.id, memo: 'Accounts receivable', debit: total, credit: ZERO },
        { accountId: a.get('4000')!.id, memo: 'Sales revenue', debit: ZERO, credit: total.minus(tax) },
      ]
      if (tax.gt(0)) {
        const payable = await requireSalesTaxPayable(job.tenantId)
        lines.push({ accountId: payable.id, memo: 'Sales tax payable', debit: ZERO, credit: tax })
      }
      return createJournalOnce(
        job.tenantId,
        source,
        job.kind === 'INVOICE_JOURNAL' ? `Invoice ${short} — AR recognition` : `Invoice ${short} — shipment extension`,
        lines.filter((l) => l.debit.gt(0) || l.credit.gt(0)),
      )
    }
    case 'CREDIT_MEMO_JOURNAL': {
      const a = await requireAccounts(job.tenantId, ['1200', '4000'])
      const total = dec(amount)
      const tax = taxOf(job, total)
      const lines = [
        { accountId: a.get('4000')!.id, memo: 'Sales revenue reversal', debit: total.minus(tax), credit: ZERO },
        { accountId: a.get('1200')!.id, memo: 'Accounts receivable reduction', debit: ZERO, credit: total },
      ]
      if (tax.gt(0)) {
        const payable = await requireSalesTaxPayable(job.tenantId)
        lines.push({ accountId: payable.id, memo: 'Sales tax payable reversal', debit: tax, credit: ZERO })
      }
      return createJournalOnce(
        job.tenantId,
        source,
        `Credit memo ${short} — AR reversal`,
        lines.filter((l) => l.debit.gt(0) || l.credit.gt(0)),
      )
    }
    case 'AR_PAYMENT_JOURNAL': {
      const a = await requireAccounts(job.tenantId, ['1000', '1200'])
      return createJournalOnce(job.tenantId, source, `AR payment ${short}`, [
        { accountId: a.get('1000')!.id, memo: 'Cash received', debit: dec(amount), credit: ZERO },
        { accountId: a.get('1200')!.id, memo: 'Accounts receivable reduction', debit: ZERO, credit: dec(amount) },
      ])
    }
    case 'AP_PAYMENT_JOURNAL': {
      const a = await requireAccounts(job.tenantId, ['2100', '1000'])
      return createJournalOnce(job.tenantId, source, `AP payment ${short}`, [
        { accountId: a.get('2100')!.id, memo: 'Accounts payable reduction', debit: dec(amount), credit: ZERO },
        { accountId: a.get('1000')!.id, memo: 'Cash paid', debit: ZERO, credit: dec(amount) },
      ])
    }
    case 'COGS_JOURNAL': {
      const a = await requireAccounts(job.tenantId, ['5000', '1100'])
      return createJournalOnce(job.tenantId, source, `COGS on ship ${short}`, [
        { accountId: a.get('5000')!.id, memo: 'Cost of goods sold', debit: dec(amount), credit: ZERO },
        { accountId: a.get('1100')!.id, memo: 'Inventory reduction', debit: ZERO, credit: dec(amount) },
      ])
    }
    case 'COGS_REVERSAL_JOURNAL': {
      const a = await requireAccounts(job.tenantId, ['5000', '1100'])
      return createJournalOnce(job.tenantId, source, `COGS reversal on return ${short}`, [
        { accountId: a.get('1100')!.id, memo: 'Inventory restored', debit: dec(amount), credit: ZERO },
        { accountId: a.get('5000')!.id, memo: 'Cost of goods sold reversal', debit: ZERO, credit: dec(amount) },
      ])
    }
    case 'PO_RECEIPT_JOURNAL': {
      const a = await requireAccounts(job.tenantId, ['1100', '2100'])
      return createJournalOnce(job.tenantId, source, `PO receipt ${short} — inventory accrual`, [
        { accountId: a.get('1100')!.id, memo: 'Inventory received', debit: dec(amount), credit: ZERO },
        { accountId: a.get('2100')!.id, memo: 'Accounts payable', debit: ZERO, credit: dec(amount) },
      ])
    }
    case 'EXPENSE_APPROVAL_JOURNAL': {
      const { expense, payable } = await ensureExpenseAccounts(job.tenantId)
      return createJournalOnce(job.tenantId, source, `Expense report approved ${short}`, [
        { accountId: expense.id, memo: 'Employee expense', debit: dec(amount), credit: ZERO },
        { accountId: payable.id, memo: 'Reimbursement payable', debit: ZERO, credit: dec(amount) },
      ])
    }
    case 'EXPENSE_PAID_JOURNAL': {
      const a = await requireAccounts(job.tenantId, ['2160', '1000'])
      return createJournalOnce(job.tenantId, source, `Expense reimbursement paid ${short}`, [
        { accountId: a.get('2160')!.id, memo: 'Clear reimbursement payable', debit: dec(amount), credit: ZERO },
        { accountId: a.get('1000')!.id, memo: 'Cash paid', debit: ZERO, credit: dec(amount) },
      ])
    }
    case 'GIFT_CARD_ISSUE_JOURNAL': {
      await ensureGiftCardLiabilityAccount(job.tenantId)
      const a = await requireAccounts(job.tenantId, ['1000', '2150'])
      return createJournalOnce(job.tenantId, source, `Gift card issued ${refShort}`, [
        { accountId: a.get('1000')!.id, memo: 'Cash received for gift card', debit: dec(amount), credit: ZERO },
        { accountId: a.get('2150')!.id, memo: 'Gift card liability', debit: ZERO, credit: dec(amount) },
      ])
    }
    case 'GIFT_CARD_REDEEM_JOURNAL': {
      await ensureGiftCardLiabilityAccount(job.tenantId)
      const a = await requireAccounts(job.tenantId, ['2150', '4000'])
      return createJournalOnce(job.tenantId, source, `Gift card redeemed ${refShort}`, [
        { accountId: a.get('2150')!.id, memo: 'Gift card liability reduction', debit: dec(amount), credit: ZERO },
        { accountId: a.get('4000')!.id, memo: 'Gift card revenue recognition', debit: ZERO, credit: dec(amount) },
      ])
    }
    default:
      throw new Error(`Unknown posting job kind ${String(job.kind)}`)
  }
}

/** Stores the journal id on a source record that lives outside the order database. */
async function writeBackOutsideOrderDb(job: { tenantId: string; kind: string; sourceId: string }, journalEntryId: string) {
  const where = { id: job.sourceId, journalEntryId: null }
  switch (job.kind) {
    case 'PO_RECEIPT_JOURNAL':
      await purchasingDb.vendorBill.updateMany({ where: { ...where, tenantId: job.tenantId }, data: { journalEntryId } })
      break
    case 'EXPENSE_APPROVAL_JOURNAL':
      // The report keeps its approval journal; the payment journal is found by its source key.
      await ledgerDb.expenseReport.updateMany({ where: { ...where, tenantId: job.tenantId }, data: { journalEntryId } })
      break
    case 'GIFT_CARD_ISSUE_JOURNAL':
    case 'GIFT_CARD_REDEEM_JOURNAL':
      await tenantDb.giftCardTransaction.updateMany({ where: { ...where, giftCard: { tenantId: job.tenantId } }, data: { journalEntryId } })
      break
  }
}

export type RunResult = { claimed: number; done: number; failed: number; dead: number }

/**
 * Claims due jobs with a compare-and-set (so parallel workers never run the same job) and posts them.
 * A RUNNING job whose lease expired (worker crashed) is claimable again.
 */
export async function runPostingJobs(opts: { now?: Date; limit?: number; tenantId?: string } = {}): Promise<RunResult> {
  const now = opts.now ?? new Date()
  const result: RunResult = { claimed: 0, done: 0, failed: 0, dead: 0 }
  const due = await orderDb.postingJob.findMany({
    where: {
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'RUNNING', leaseUntil: { lte: now } },
      ],
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: opts.limit ?? 50,
  })

  for (const candidate of due) {
    const claim = await orderDb.postingJob.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: 'PENDING', nextAttemptAt: { lte: now } },
          { status: 'RUNNING', leaseUntil: { lte: now } },
        ],
      },
      data: { status: 'RUNNING', leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
    })
    if (claim.count !== 1) continue
    result.claimed++
    const attempts = candidate.attempts + 1

    try {
      const journalEntryId = await postJob({
        id: candidate.id,
        tenantId: candidate.tenantId,
        kind: candidate.kind as PostingJobKind,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        variant: candidate.variant,
        payload: candidate.payload,
      })
      // Records kept in other databases get their journal id first: if this fails the job is retried,
      // and the posting itself is idempotent, so the write-back is never lost.
      if (journalEntryId) await writeBackOutsideOrderDb(candidate, journalEntryId)
      await orderDb.$transaction(async (tx) => {
        await tx.postingJob.update({
          where: { id: candidate.id },
          data: { status: 'DONE', journalEntryId: journalEntryId ?? undefined, doneAt: new Date(), leaseUntil: null, lastError: null },
        })
        if (journalEntryId && candidate.kind === 'INVOICE_JOURNAL') {
          await tx.invoice.updateMany({
            where: { id: candidate.sourceId, tenantId: candidate.tenantId, journalEntryId: null },
            data: { journalEntryId },
          })
        } else if (journalEntryId && candidate.kind === 'CREDIT_MEMO_JOURNAL') {
          await tx.creditMemo.updateMany({
            where: { id: candidate.sourceId, tenantId: candidate.tenantId, journalEntryId: null },
            data: { journalEntryId },
          })
        }
      })
      result.done++
    } catch (err) {
      const message = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 1000)
      const dead = attempts >= MAX_POSTING_ATTEMPTS
      await orderDb.postingJob.update({
        where: { id: candidate.id },
        data: {
          status: dead ? 'DEAD' : 'PENDING',
          lastError: message,
          leaseUntil: null,
          nextAttemptAt: dead ? candidate.nextAttemptAt : new Date(now.getTime() + postingBackoffMs(attempts)),
        },
      })
      if (dead) {
        result.dead++
        console.error(`[gl] posting job ${candidate.id} (${candidate.kind}) is DEAD after ${attempts} attempts: ${message}`)
        console.error('[metric] posting_jobs_dead 1')
      } else {
        result.failed++
        console.warn(`[gl] posting job ${candidate.id} (${candidate.kind}) failed attempt ${attempts}: ${message}`)
      }
    }
  }
  return result
}

export async function postingQueueStats(tenantId?: string, now = new Date()) {
  const where = tenantId ? { tenantId } : {}
  const [pending, running, dead, oldest] = await Promise.all([
    orderDb.postingJob.count({ where: { ...where, status: 'PENDING' } }),
    orderDb.postingJob.count({ where: { ...where, status: 'RUNNING' } }),
    orderDb.postingJob.count({ where: { ...where, status: 'DEAD' } }),
    orderDb.postingJob.findFirst({
      where: { ...where, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ])
  return {
    pending,
    running,
    dead,
    oldestPendingAgeSeconds: oldest ? Math.max(0, Math.round((now.getTime() - oldest.createdAt.getTime()) / 1000)) : 0,
  }
}

export async function listPostingJobs(tenantId: string, statuses: Array<'PENDING' | 'RUNNING' | 'DONE' | 'DEAD'> = ['PENDING', 'DEAD']) {
  return orderDb.postingJob.findMany({
    where: { tenantId, status: { in: statuses } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })
}

/** Puts a DEAD (or waiting) job back in the queue immediately. */
export async function retryPostingJob(tenantId: string, id: string) {
  const res = await orderDb.postingJob.updateMany({
    where: { id, tenantId, status: { in: ['DEAD', 'PENDING'] } },
    data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), leaseUntil: null },
  })
  if (res.count !== 1) throw new ApiError(404, 'Posting job not found or not retryable')
  return orderDb.postingJob.findUniqueOrThrow({ where: { id } })
}

/**
 * Invoices older than `olderThanMs` whose AR journal has not been recorded. A non-empty result means a
 * posting job is stuck, dead, or the invoice pre-dates the outbox.
 */
export async function findInvoicesMissingPosting(opts: { tenantId?: string; olderThanMs?: number; now?: Date; limit?: number } = {}) {
  const cutoff = new Date((opts.now ?? new Date()).getTime() - (opts.olderThanMs ?? 15 * 60_000))
  return orderDb.invoice.findMany({
    where: {
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      journalEntryId: null,
      issuedAt: { lt: cutoff },
      totalAmount: { gt: 0 },
    },
    select: { id: true, tenantId: true, invoiceNumber: true, totalAmount: true, issuedAt: true },
    orderBy: { issuedAt: 'asc' },
    take: opts.limit ?? 500,
  })
}
