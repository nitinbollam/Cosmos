import {
  AccountType,
  BankMatchType,
  BankReconciliationStatus,
  BankStatementSource,
  Prisma,
  type BankAccount,
  type BankReconciliation,
} from '@/generated/prisma-ledger'
import { auditLog } from './audit-log'
import { assertStatementDatesOpen, lockBankAccount } from './bank-period-lock'
import {
  addDays,
  dayDiff,
  isoDate,
  money,
  parseStatementCsv,
  requireIsoDate,
  requireMoney,
  startOfUtcDay,
  withDedupeKeys,
  type CsvMapping,
} from './bank-statement-csv'
import { authDb, ledgerDb } from './db'
import { ApiError } from './session'

/**
 * Bank reconciliation per tenant, bank account and statement period.
 *
 * Book side: posted journal lines on the bank account's linked GL account (BankAccount.chartAccountId).
 * Bank side: imported statement lines (+ = money in). All money is Prisma.Decimal; nothing is summed
 * as a JS number. Every mutation runs in one ledger transaction that first locks the bank account
 * (lockBankAccount, shared with imports, Plaid and journal posting), then bumps the reconciliation's
 * version, writes an append-only BankReconciliationEvent, and is mirrored to the tenant audit log
 * after commit.
 *
 * An active match owns its bank and book items everywhere: they are never offered for matching in
 * another period. For a period's balances, a match clears its items only when every item of it is
 * dated in or before that period; otherwise the items dated in the period stay reconciling items
 * (outstanding at period end). A signed-off period is computed from the matches that were active at
 * its sign-off, so later work in other periods never changes what was signed.
 */

/** Review defaults (see bank-reconciliation-implementation-decisions.md). Mutable for tests only. */
export const RECON_RULES = {
  /** Separation of duties: signer must differ from the creator and the last preparer. */
  requireDistinctSigner: false,
  /** Sign-off needs the previous period of the same account to be signed off. */
  requirePriorPeriodSignedOff: false,
  /** Bank-only items (fees, interest) must be booked by an adjusting entry and matched first. */
  blockSignOffWithUnrecordedBankItems: true,
}

export const DEFAULT_DATE_WINDOW_DAYS = 3
const MAX_DATE_WINDOW_DAYS = 31
const MAX_PERIOD_DAYS = 366
const MAX_MATCH_SIDE = 100
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 }

export type ReconActor = { tenantId: string; userId: string }

type Db = Prisma.TransactionClient
type ReconWithAccount = BankReconciliation & { bankAccount: BankAccount }
type PendingEvent = {
  bankAccountId: string
  reconciliationId?: string | null
  action: string
  metadata?: Record<string, unknown>
}

const ZERO = new Prisma.Decimal(0)
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), ZERO)
/** Re-wraps a Decimal read from the database (never a JS number), so arithmetic starts from a fresh instance. */
const dec = (v: Prisma.Decimal) => new Prisma.Decimal(v) // money-ok: input is already a Decimal

// ---------------------------------------------------------------------------------------------
// Transactions, locking and audit

function isKnownError(e: unknown, codes: string[]): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code)
}

/**
 * Runs `fn` in one transaction whose first statement locks the bank account; events are written
 * inside it and mirrored to the audit log after commit.
 */
async function runRecon<T>(
  actor: ReconActor,
  bankAccountId: string,
  fn: (tx: Db, emit: (e: PendingEvent) => Promise<void>) => Promise<T>,
  opts: { serializable?: boolean } = {},
): Promise<T> {
  const emitted: PendingEvent[] = []
  let result: T
  try {
    result = await ledgerDb.$transaction(
      async (tx) => {
        await lockBankAccount(tx, actor.tenantId, bankAccountId)
        const emit = async (e: PendingEvent) => {
          await tx.bankReconciliationEvent.create({
            data: {
              tenantId: actor.tenantId,
              bankAccountId: e.bankAccountId,
              reconciliationId: e.reconciliationId ?? null,
              action: e.action,
              userId: actor.userId,
              metadata: (e.metadata ?? {}) as Prisma.InputJsonValue,
            },
          })
          emitted.push(e)
        }
        return fn(tx, emit)
      },
      {
        ...TX_OPTIONS,
        ...(opts.serializable ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } : {}),
      },
    )
  } catch (e) {
    // Unique index on active match items, or a serialization/write conflict: someone else won.
    if (isKnownError(e, ['P2002', 'P2034'])) {
      throw new ApiError(409, 'Another change to this reconciliation happened at the same time; reload and retry')
    }
    throw e
  }
  for (const e of emitted) {
    try {
      await auditLog(actor.tenantId, {
        action: e.action,
        entityType: 'BankReconciliation',
        entityId: e.reconciliationId ?? e.bankAccountId,
        userId: actor.userId,
        metadata: { bankAccountId: e.bankAccountId, ...e.metadata },
      })
    } catch (err) {
      // The ledger event is the authoritative trail; a mirror failure must be visible, not fatal.
      console.error(`[bank-recon] audit mirror failed for ${e.action}:`, err)
    }
  }
  return result
}

async function findRecon(db: Db, tenantId: string, id: string): Promise<ReconWithAccount> {
  const recon = await db.bankReconciliation.findFirst({ where: { id, tenantId }, include: { bankAccount: true } })
  if (!recon) throw new ApiError(404, 'Reconciliation not found')
  return recon
}

/** The bank account a reconciliation belongs to (never changes), read before its transaction locks it. */
async function reconAccountId(tenantId: string, id: string): Promise<string> {
  const recon = await ledgerDb.bankReconciliation.findFirst({ where: { id, tenantId }, select: { bankAccountId: true } })
  if (!recon) throw new ApiError(404, 'Reconciliation not found')
  return recon.bankAccountId
}

/**
 * First statement of every mutating transaction: bumps the version (row lock on Postgres, write lock
 * on SQLite) only while the period is open, so matching, import and sign-off serialize per period.
 */
async function lockOpenRecon(tx: Db, actor: ReconActor, id: string): Promise<ReconWithAccount> {
  const res = await tx.bankReconciliation.updateMany({
    where: { id, tenantId: actor.tenantId, status: { not: BankReconciliationStatus.SIGNED_OFF } },
    data: {
      version: { increment: 1 },
      status: BankReconciliationStatus.IN_PROGRESS,
      preparedById: actor.userId,
      preparedAt: new Date(),
    },
  })
  const recon = await findRecon(tx, actor.tenantId, id)
  if (res.count === 0) throw new ApiError(409, 'This period is signed off; reopen it before making changes')
  return recon
}

// ---------------------------------------------------------------------------------------------
// Workspace (balances and item lists)

type MatchRow = Prisma.BankReconciliationMatchGetPayload<{
  include: {
    reconciliation: { select: { periodStart: true; periodEnd: true } }
    items: {
      include: {
        statementLine: { select: { postedAt: true; description: true } }
        journalLine: { select: { entry: { select: { postedAt: true; description: true } } } }
      }
    }
  }
}>
type BookItem = { id: string; entryId: string; date: Date; description: string; memo: string | null; amount: Prisma.Decimal }
type BankItem = { id: string; date: Date; description: string; reference: string | null; amount: Prisma.Decimal }

/** Items dated before this are treated as cleared before reconciliation started. */
async function cutoffFor(db: Db, recon: ReconWithAccount): Promise<Date> {
  if (recon.bankAccount.openingBalanceDate) return startOfUtcDay(recon.bankAccount.openingBalanceDate)
  const first = await db.bankReconciliation.findFirst({
    where: { tenantId: recon.tenantId, bankAccountId: recon.bankAccountId },
    orderBy: { periodStart: 'asc' },
    select: { periodStart: true },
  })
  return first?.periodStart ?? recon.periodStart
}

async function computeWorkspace(db: Db, recon: ReconWithAccount) {
  const tenantId = recon.tenantId
  const glAccountId = recon.bankAccount.chartAccountId
  if (!glAccountId) throw new ApiError(409, 'Link this bank account to a GL cash account first')
  const endExcl = addDays(recon.periodEnd, 1)
  const cutoff = await cutoffFor(db, recon)

  // A signed-off period is shown as it was signed: the matches that were active at sign-off.
  const asOf = recon.status === BankReconciliationStatus.SIGNED_OFF ? recon.signedOffAt : null

  const [bookRows, bankRows, matchRows] = await Promise.all([
    db.journalLine.findMany({
      where: {
        accountId: glAccountId,
        account: { tenantId },
        entry: { tenantId, isPosted: true, postedAt: { lt: endExcl } },
      },
      select: { id: true, debit: true, credit: true, memo: true, entry: { select: { id: true, postedAt: true, description: true } } },
    }),
    db.bankStatementLine.findMany({
      where: { tenantId, bankAccountId: recon.bankAccountId, postedAt: { gte: cutoff, lt: endExcl } },
      select: { id: true, postedAt: true, description: true, reference: true, amount: true },
      orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
    }),
    // Matches of every period of this account, with the dates of all their items.
    db.bankReconciliationMatch.findMany({
      where: {
        tenantId,
        reconciliation: { tenantId, bankAccountId: recon.bankAccountId },
        ...(asOf ? { createdAt: { lte: asOf }, OR: [{ unmatchedAt: null }, { unmatchedAt: { gt: asOf } }] } : { unmatchedAt: null }),
      },
      include: {
        reconciliation: { select: { periodStart: true, periodEnd: true } },
        items: {
          include: {
            statementLine: { select: { postedAt: true, description: true } },
            journalLine: { select: { entry: { select: { postedAt: true, description: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const itemDate = (i: MatchRow['items'][number]) => i.statementLine?.postedAt ?? i.journalLine?.entry.postedAt ?? null
  const clearsHere = (m: MatchRow) => m.items.every((i) => {
    const d = itemDate(i)
    return d !== null && d < endExcl
  })
  const clearedBank = new Set<string>()
  const clearedBook = new Set<string>()
  const heldBank = new Set<string>()
  const heldBook = new Set<string>()
  for (const m of matchRows) {
    const cleared = clearsHere(m)
    for (const i of m.items) {
      if (i.statementLineId) (cleared ? clearedBank : heldBank).add(i.statementLineId)
      if (i.journalLineId) (cleared ? clearedBook : heldBook).add(i.journalLineId)
    }
  }
  const matches = matchRows.filter((m) => m.reconciliationId === recon.id)
  // Later periods' matches that reach back into this one: shown so the user sees why an item is not open here.
  const otherPeriodMatches = matchRows
    .filter((m) => m.reconciliationId !== recon.id && m.reconciliation.periodEnd > recon.periodEnd)
    .filter((m) => m.items.some((i) => {
      const d = itemDate(i)
      return d !== null && d >= cutoff && d < endExcl
    }))
    .map((m) => ({ match: m, clearedAsOfThisPeriod: clearsHere(m) }))

  const book: BookItem[] = bookRows.map((r) => ({
    id: r.id,
    entryId: r.entry.id,
    date: r.entry.postedAt,
    description: r.entry.description,
    memo: r.memo,
    amount: dec(r.debit).minus(r.credit),
  }))
  const bank: BankItem[] = bankRows.map((r) => ({
    id: r.id,
    date: r.postedAt,
    description: r.description,
    reference: r.reference,
    amount: dec(r.amount),
  }))

  // Reconciling items: not cleared as of this period. Unmatched: reconciling and not owned by any match.
  const outstandingBook = book.filter((b) => b.date >= cutoff && !clearedBook.has(b.id)).sort((a, b) => +a.date - +b.date)
  const outstandingBank = bank.filter((b) => !clearedBank.has(b.id))
  const unmatchedBook = outstandingBook.filter((b) => !heldBook.has(b.id))
  const unmatchedBank = outstandingBank.filter((b) => !heldBank.has(b.id))
  const periodBank = bank.filter((b) => b.date >= recon.periodStart)

  const bookBalance = sum(book.map((b) => b.amount))
  const bankBalance = dec(recon.statementClosingBalance)
  const depositsInTransit = sum(outstandingBook.filter((b) => b.amount.isPositive()).map((b) => b.amount))
  const outstandingPayments = sum(outstandingBook.filter((b) => b.amount.isNegative()).map((b) => b.amount.negated()))
  const unrecordedBankItems = sum(outstandingBank.map((b) => b.amount))
  const adjustedBank = bankBalance.plus(depositsInTransit).minus(outstandingPayments)
  const adjustedBook = bookBalance.plus(unrecordedBankItems)
  const statementComputedClosing = dec(recon.statementOpeningBalance).plus(sum(periodBank.map((b) => b.amount)))

  return {
    cutoff,
    endExcl,
    unmatchedBook,
    unmatchedBank,
    matches,
    otherPeriodMatches,
    balances: {
      bookBalance,
      bankBalance,
      depositsInTransit,
      outstandingPayments,
      unrecordedBankItems,
      adjustedBook,
      adjustedBank,
      difference: adjustedBook.minus(adjustedBank),
      statementComputedClosing,
      statementDifference: bankBalance.minus(statementComputedClosing),
    },
    bookById: new Map(book.map((b) => [b.id, b])),
    bankById: new Map(bank.map((b) => [b.id, b])),
  }
}

type Workspace = Awaited<ReturnType<typeof computeWorkspace>>

function signOffBlockers(recon: ReconWithAccount, ws: Workspace, now = new Date()): string[] {
  const blockers: string[] = []
  if (recon.periodEnd >= startOfUtcDay(now)) blockers.push('The statement period has not ended yet')
  if (!ws.balances.difference.isZero()) {
    blockers.push(`Adjusted book and adjusted bank balances differ by ${money(ws.balances.difference)}`)
  }
  if (RECON_RULES.blockSignOffWithUnrecordedBankItems && ws.unmatchedBank.length) {
    blockers.push(
      `${ws.unmatchedBank.length} bank item(s) are not in the books; post an adjusting journal entry and match it first`,
    )
  }
  return blockers
}

function serializeRecon(r: BankReconciliation) {
  const opt = (d: Prisma.Decimal | null) => (d === null ? null : money(dec(d)))
  return {
    id: r.id,
    bankAccountId: r.bankAccountId,
    periodStart: isoDate(r.periodStart),
    periodEnd: isoDate(r.periodEnd),
    statementOpeningBalance: money(dec(r.statementOpeningBalance)),
    statementClosingBalance: money(dec(r.statementClosingBalance)),
    status: r.status,
    dateWindowDays: r.dateWindowDays,
    createdById: r.createdById,
    preparedById: r.preparedById,
    preparedAt: r.preparedAt?.toISOString() ?? null,
    signedOffById: r.signedOffById,
    signedOffAt: r.signedOffAt?.toISOString() ?? null,
    snapshot: {
      bookBalance: opt(r.bookBalanceSnapshot),
      adjustedBook: opt(r.adjustedBookSnapshot),
      adjustedBank: opt(r.adjustedBankSnapshot),
    },
    version: r.version,
    reopenedCount: r.reopenedCount,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

function maskAccountNumber(n: string | null): string | null {
  if (!n) return null
  return n.length <= 4 ? '••••' : `••••${n.slice(-4)}`
}

function serializeWorkspace(recon: ReconWithAccount, ws: Workspace) {
  const bal = Object.fromEntries(Object.entries(ws.balances).map(([k, v]) => [k, money(v)])) as Record<
    keyof Workspace['balances'],
    string
  >
  const bookOut = (b: BookItem) => ({
    journalLineId: b.id,
    journalEntryId: b.entryId,
    date: isoDate(b.date),
    description: b.description,
    memo: b.memo,
    amount: money(b.amount),
  })
  const bankOut = (b: BankItem) => ({
    statementLineId: b.id,
    date: isoDate(b.date),
    description: b.description,
    reference: b.reference,
    amount: money(b.amount),
    carriedForward: b.date < recon.periodStart,
  })
  const signedOff = recon.status === BankReconciliationStatus.SIGNED_OFF
  const blockers = signedOff ? [] : signOffBlockers(recon, ws)
  // Read-only preview of what auto-match would pair now; applying it re-plans inside the locked transaction.
  const plan = signedOff
    ? { pairs: [], ambiguousStatementLineIds: [], ambiguousJournalLineIds: [] }
    : planAutoMatches(ws.unmatchedBank, ws.unmatchedBook, recon.dateWindowDays)
  return {
    reconciliation: serializeRecon(recon),
    bankAccount: {
      id: recon.bankAccount.id,
      name: recon.bankAccount.name,
      accountNumberMasked: maskAccountNumber(recon.bankAccount.accountNumber),
      chartAccountId: recon.bankAccount.chartAccountId,
      currency: recon.bankAccount.currency,
    },
    balances: bal,
    matched: ws.matches.map((m) => ({
      matchId: m.id,
      type: m.type,
      createdById: m.createdById,
      createdAt: m.createdAt.toISOString(),
      statementLines: m.items
        .filter((i) => i.statementLineId)
        .map((i) => {
          const line = ws.bankById.get(i.statementLineId!)
          return {
            statementLineId: i.statementLineId,
            date: line ? isoDate(line.date) : null,
            description: line?.description ?? null,
            amount: money(dec(i.amount)),
          }
        }),
      journalLines: m.items
        .filter((i) => i.journalLineId)
        .map((i) => {
          const line = ws.bookById.get(i.journalLineId!)
          return {
            journalLineId: i.journalLineId,
            date: line ? isoDate(line.date) : null,
            description: line?.description ?? null,
            amount: money(dec(i.amount)),
          }
        }),
    })),
    otherPeriodMatches: ws.otherPeriodMatches.map(({ match: m, clearedAsOfThisPeriod }) => ({
      matchId: m.id,
      reconciliationId: m.reconciliationId,
      periodStart: isoDate(m.reconciliation.periodStart),
      periodEnd: isoDate(m.reconciliation.periodEnd),
      /** true: every item is dated in or before this period, so it is cleared here too. */
      clearedAsOfThisPeriod,
      createdById: m.createdById,
      statementLines: m.items
        .filter((i) => i.statementLineId)
        .map((i) => ({
          statementLineId: i.statementLineId,
          date: i.statementLine ? isoDate(i.statementLine.postedAt) : null,
          description: i.statementLine?.description ?? null,
          amount: money(dec(i.amount)),
        })),
      journalLines: m.items
        .filter((i) => i.journalLineId)
        .map((i) => ({
          journalLineId: i.journalLineId,
          date: i.journalLine ? isoDate(i.journalLine.entry.postedAt) : null,
          description: i.journalLine?.entry.description ?? null,
          amount: money(dec(i.amount)),
        })),
    })),
    unmatchedBook: ws.unmatchedBook.map(bookOut),
    unmatchedBank: ws.unmatchedBank.map(bankOut),
    autoMatchPreview: {
      dateWindowDays: recon.dateWindowDays,
      pairs: plan.pairs,
      ambiguousStatementLineIds: plan.ambiguousStatementLineIds,
      ambiguousJournalLineIds: plan.ambiguousJournalLineIds,
    },
    signOff: { canSignOff: blockers.length === 0 && !signedOff, blockers },
  }
}

/** Shown instead of an id for a user who was deleted, or who is not a user of this tenant. */
export const UNKNOWN_USER_LABEL = 'Deleted or unavailable user'
/** Shown for events written without a user (Plaid webhooks). */
export const SYSTEM_ACTOR_LABEL = 'System'

/**
 * Display labels ("First Last <email>") for the users a workspace names. Same tenant only: an id
 * that is unknown here, or belongs to another tenant, gets UNKNOWN_USER_LABEL, never a raw id.
 */
async function peopleFor(tenantId: string, ids: (string | null)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))]
  if (!unique.length) return {}
  const users = await authDb.user.findMany({
    where: { tenantId, id: { in: unique } },
    select: { id: true, firstName: true, lastName: true, email: true },
  })
  const found = new Map(
    users.map((u) => [u.id, `${[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email} <${u.email}>`]),
  )
  return Object.fromEntries(unique.map((id) => [id, found.get(id) ?? UNKNOWN_USER_LABEL]))
}

export type ReconciliationWorkspace = ReturnType<typeof serializeWorkspace> & { people: Record<string, string> }

// ---------------------------------------------------------------------------------------------
// Queries

export async function listReconciliations(
  tenantId: string,
  filters: { bankAccountId?: string; status?: string } = {},
) {
  const status =
    filters.status && (Object.values(BankReconciliationStatus) as string[]).includes(filters.status)
      ? (filters.status as BankReconciliationStatus)
      : undefined
  if (filters.status && !status) throw new ApiError(400, 'Unknown status')
  const rows = await ledgerDb.bankReconciliation.findMany({
    where: { tenantId, ...(filters.bankAccountId ? { bankAccountId: filters.bankAccountId } : {}), ...(status ? { status } : {}) },
    orderBy: [{ bankAccountId: 'asc' }, { periodEnd: 'desc' }],
    take: 500,
  })
  return rows.map(serializeRecon)
}

export async function getReconciliationWorkspace(tenantId: string, id: string): Promise<ReconciliationWorkspace> {
  const recon = await findRecon(ledgerDb, tenantId, id)
  const ws = serializeWorkspace(recon, await computeWorkspace(ledgerDb, recon))
  const r = ws.reconciliation
  const actors = await ledgerDb.bankReconciliationEvent.findMany({
    where: { tenantId, reconciliationId: id, userId: { not: null } },
    select: { userId: true },
    distinct: ['userId'],
  })
  const people = await peopleFor(tenantId, [
    r.createdById,
    r.preparedById,
    r.signedOffById,
    ...ws.matched.map((m) => m.createdById),
    ...ws.otherPeriodMatches.map((m) => m.createdById),
    ...actors.map((a) => a.userId),
  ])
  return { ...ws, people }
}

export async function listReconciliationEvents(tenantId: string, id: string) {
  await findRecon(ledgerDb, tenantId, id)
  const rows = await ledgerDb.bankReconciliationEvent.findMany({
    where: { tenantId, reconciliationId: id },
    orderBy: { createdAt: 'asc' },
  })
  const people = await peopleFor(tenantId, rows.map((e) => e.userId))
  return rows.map((e) => ({
    id: e.id,
    action: e.action,
    userId: e.userId,
    actorName: e.userId ? people[e.userId]! : SYSTEM_ACTOR_LABEL,
    metadata: e.metadata,
    createdAt: e.createdAt.toISOString(),
  }))
}

// ---------------------------------------------------------------------------------------------
// Create / update

function parseWindow(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_DATE_WINDOW_DAYS) {
    throw new ApiError(400, `dateWindowDays must be a whole number from 0 to ${MAX_DATE_WINDOW_DAYS}`)
  }
  return v
}

export type CreateReconciliationInput = {
  bankAccountId?: unknown
  periodStart?: unknown
  periodEnd?: unknown
  statementOpeningBalance?: unknown
  statementClosingBalance?: unknown
  dateWindowDays?: unknown
}

export async function createReconciliation(actor: ReconActor, body: CreateReconciliationInput) {
  if (typeof body.bankAccountId !== 'string' || !body.bankAccountId) throw new ApiError(400, 'bankAccountId is required')
  const periodStart = requireIsoDate(body.periodStart, 'periodStart')
  const periodEnd = requireIsoDate(body.periodEnd, 'periodEnd')
  if (periodEnd < periodStart) throw new ApiError(400, 'periodEnd must not be before periodStart')
  if (dayDiff(periodEnd, periodStart) >= MAX_PERIOD_DAYS) throw new ApiError(400, 'Statement period is longer than a year')
  const opening = requireMoney(body.statementOpeningBalance, 'statementOpeningBalance')
  const closing = requireMoney(body.statementClosingBalance, 'statementClosingBalance')
  const dateWindowDays = parseWindow(body.dateWindowDays) ?? DEFAULT_DATE_WINDOW_DAYS
  const bankAccountId = body.bankAccountId

  return runRecon(actor, bankAccountId, async (tx, emit) => {
    const bank = await tx.bankAccount.findFirst({ where: { id: bankAccountId, tenantId: actor.tenantId, isActive: true } })
    if (!bank) throw new ApiError(404, 'Bank account not found')
    if (!bank.chartAccountId) throw new ApiError(409, 'Link this bank account to a GL cash account before reconciling')
    await assertCashChartAccount(tx, actor.tenantId, bank.chartAccountId)
    const overlap = await tx.bankReconciliation.findFirst({
      where: { tenantId: actor.tenantId, bankAccountId, periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } },
      select: { id: true },
    })
    if (overlap) throw new ApiError(409, 'A reconciliation already covers part of this period for this account')
    const recon = await tx.bankReconciliation.create({
      data: {
        tenantId: actor.tenantId,
        bankAccountId,
        periodStart,
        periodEnd,
        statementOpeningBalance: opening,
        statementClosingBalance: closing,
        dateWindowDays,
        createdById: actor.userId,
      },
    })
    await emit({
      bankAccountId,
      reconciliationId: recon.id,
      action: 'bank_recon.created',
      metadata: { periodStart: isoDate(periodStart), periodEnd: isoDate(periodEnd), opening: money(opening), closing: money(closing) },
    })
    return serializeRecon(recon)
  })
}

export async function updateReconciliation(
  actor: ReconActor,
  id: string,
  body: { statementOpeningBalance?: unknown; statementClosingBalance?: unknown; dateWindowDays?: unknown },
) {
  const data: Prisma.BankReconciliationUpdateInput = {}
  if (body.statementOpeningBalance !== undefined) data.statementOpeningBalance = requireMoney(body.statementOpeningBalance, 'statementOpeningBalance')
  if (body.statementClosingBalance !== undefined) data.statementClosingBalance = requireMoney(body.statementClosingBalance, 'statementClosingBalance')
  const window = parseWindow(body.dateWindowDays)
  if (window !== undefined) data.dateWindowDays = window
  if (!Object.keys(data).length) throw new ApiError(400, 'Nothing to update')

  return runRecon(actor, await reconAccountId(actor.tenantId, id), async (tx, emit) => {
    const before = await lockOpenRecon(tx, actor, id)
    const after = await tx.bankReconciliation.update({ where: { id: before.id, tenantId: actor.tenantId }, data })
    await emit({
      bankAccountId: before.bankAccountId,
      reconciliationId: id,
      action: 'bank_recon.updated',
      metadata: {
        before: {
          opening: money(dec(before.statementOpeningBalance)),
          closing: money(dec(before.statementClosingBalance)),
          dateWindowDays: before.dateWindowDays,
        },
        after: {
          opening: money(dec(after.statementOpeningBalance)),
          closing: money(dec(after.statementClosingBalance)),
          dateWindowDays: after.dateWindowDays,
        },
      },
    })
    return serializeRecon(after)
  })
}

export async function assertCashChartAccount(db: Db, tenantId: string, chartAccountId: string) {
  const acct = await db.chartAccount.findFirst({ where: { id: chartAccountId, tenantId } })
  if (!acct) throw new ApiError(400, 'GL account not found')
  if (acct.type !== AccountType.ASSET) throw new ApiError(400, 'The GL account for a bank must be an asset account')
  if (!acct.isActive) throw new ApiError(400, 'The GL account is inactive')
  return acct
}

// ---------------------------------------------------------------------------------------------
// CSV import

export async function importStatementCsv(
  actor: ReconActor,
  id: string,
  body: { csvText?: unknown; mapping?: Partial<CsvMapping>; fileName?: unknown },
) {
  const peek = await findRecon(ledgerDb, actor.tenantId, id)
  const parsed = parseStatementCsv(body.csvText, body.mapping, { periodStart: peek.periodStart, periodEnd: peek.periodEnd })
  if (parsed.errors.length) {
    throw new ApiError(400, `${parsed.errors.length} row(s) failed validation; nothing was imported`, undefined, parsed.errors)
  }
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim().slice(0, 200) || null : null

  return runRecon(actor, peek.bankAccountId, async (tx, emit) => {
    const recon = await lockOpenRecon(tx, actor, id)
    const bankAccountId = recon.bankAccountId
    const dupFile = await tx.bankStatementImport.findFirst({
      where: { tenantId: actor.tenantId, bankAccountId, fileSha256: parsed.fileSha256 },
      select: { id: true, createdAt: true },
    })
    if (dupFile) {
      throw new ApiError(409, `This file was already imported for this account on ${dupFile.createdAt.toISOString()}`)
    }
    await assertStatementDatesOpen(tx, actor.tenantId, bankAccountId, parsed.lines.map((l) => l.postedAt))

    const keyed = withDedupeKeys(bankAccountId, parsed.lines)
    const existing = await tx.bankStatementLine.findMany({
      where: { tenantId: actor.tenantId, bankAccountId, dedupeKey: { in: keyed.map((l) => l.dedupeKey) } },
      select: { dedupeKey: true },
    })
    const known = new Set(existing.map((e) => e.dedupeKey))
    const fresh = keyed.filter((l) => !known.has(l.dedupeKey))
    const duplicates = keyed.filter((l) => known.has(l.dedupeKey))

    const imp = await tx.bankStatementImport.create({
      data: {
        tenantId: actor.tenantId,
        bankAccountId,
        reconciliationId: id,
        fileName,
        fileSha256: parsed.fileSha256,
        rowCount: parsed.rowCount,
        importedCount: fresh.length,
        duplicateCount: duplicates.length,
        importedById: actor.userId,
      },
    })
    if (fresh.length) {
      await tx.bankStatementLine.createMany({
        data: fresh.map((l) => ({
          tenantId: actor.tenantId,
          bankAccountId,
          postedAt: l.postedAt,
          description: l.description,
          amount: l.amount,
          reference: l.reference,
          dedupeKey: l.dedupeKey,
          source: BankStatementSource.CSV,
          importId: imp.id,
        })),
      })
    }
    await emit({
      bankAccountId,
      reconciliationId: id,
      action: 'bank_statement.imported',
      metadata: { importId: imp.id, fileSha256: parsed.fileSha256, rows: parsed.rowCount, imported: fresh.length },
    })
    if (duplicates.length) {
      await emit({
        bankAccountId,
        reconciliationId: id,
        action: 'bank_statement.duplicate_skipped',
        metadata: { importId: imp.id, rows: duplicates.map((d) => d.row) },
      })
    }
    return {
      importId: imp.id,
      rowCount: parsed.rowCount,
      imported: fresh.length,
      skippedDuplicates: duplicates.length,
      duplicateRows: duplicates.map((d) => d.row),
      errors: [] as { row: number; message: string }[],
    }
  })
}

// ---------------------------------------------------------------------------------------------
// Matching

export type MatchCandidate = { id: string; date: Date; amount: Prisma.Decimal }

/**
 * Deterministic auto-match: a bank line and a book line pair up only when each is the other's single
 * candidate (equal signed amount, dates within the window). Anything with more than one candidate on
 * either side is left for manual review — ambiguity is never resolved by a tie-breaker.
 */
export function planAutoMatches(bank: MatchCandidate[], book: MatchCandidate[], windowDays: number) {
  const fits = (b: MatchCandidate, k: MatchCandidate) => b.amount.equals(k.amount) && Math.abs(dayDiff(b.date, k.date)) <= windowDays
  const bankCands = new Map(bank.map((b) => [b.id, book.filter((k) => fits(b, k))]))
  const bookCands = new Map(book.map((k) => [k.id, bank.filter((b) => fits(b, k))]))
  const pairs: { statementLineId: string; journalLineId: string }[] = []
  const ambiguousStatementLineIds: string[] = []
  for (const b of bank) {
    const cands = bankCands.get(b.id)!
    if (cands.length === 0) continue
    if (cands.length === 1 && bookCands.get(cands[0]!.id)!.length === 1) {
      pairs.push({ statementLineId: b.id, journalLineId: cands[0]!.id })
    } else ambiguousStatementLineIds.push(b.id)
  }
  const ambiguousJournalLineIds = book
    .filter((k) => bookCands.get(k.id)!.length > 1 || bookCands.get(k.id)!.some((b) => bankCands.get(b.id)!.length > 1))
    .map((k) => k.id)
  return { pairs, ambiguousStatementLineIds, ambiguousJournalLineIds }
}

async function assertNotActivelyMatched(tx: Db, tenantId: string, statementLineIds: string[], journalLineIds: string[]) {
  const active = await tx.bankReconciliationMatchItem.findFirst({
    where: {
      tenantId,
      OR: [{ activeStatementLineId: { in: statementLineIds } }, { activeJournalLineId: { in: journalLineIds } }],
    },
    select: { match: { select: { reconciliation: { select: { periodStart: true, periodEnd: true } } } } },
  })
  if (active) {
    const r = active.match.reconciliation
    throw new ApiError(
      409,
      `One or more items are already matched in the reconciliation for ${isoDate(r.periodStart)} to ${isoDate(r.periodEnd)}; unmatch them there first`,
    )
  }
}

async function createMatch(
  tx: Db,
  actor: ReconActor,
  recon: ReconWithAccount,
  type: BankMatchType,
  bankItems: { id: string; amount: Prisma.Decimal }[],
  bookItems: { id: string; amount: Prisma.Decimal }[],
) {
  const match = await tx.bankReconciliationMatch.create({
    data: {
      tenantId: actor.tenantId,
      reconciliationId: recon.id,
      type,
      createdById: actor.userId,
      items: {
        create: [
          ...bankItems.map((b) => ({ tenantId: actor.tenantId, statementLineId: b.id, activeStatementLineId: b.id, amount: b.amount })),
          ...bookItems.map((k) => ({ tenantId: actor.tenantId, journalLineId: k.id, activeJournalLineId: k.id, amount: k.amount })),
        ],
      },
    },
  })
  // BankStatementLine.reconciled is left alone: it marks lines of the retired line-only workflow, whose
  // amounts were added to BankAccount.currentBalance. Matched status is the active match item.
  return match
}

function idList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, `${field} must be a non-empty array`)
  if (value.length > MAX_MATCH_SIDE) throw new ApiError(400, `${field} has more than ${MAX_MATCH_SIDE} ids`)
  if (value.some((v) => typeof v !== 'string' || !v)) throw new ApiError(400, `${field} must contain ids`)
  if (new Set(value).size !== value.length) throw new ApiError(400, `${field} contains duplicates`)
  return value as string[]
}

export async function createManualMatch(
  actor: ReconActor,
  id: string,
  body: { statementLineIds?: unknown; journalLineIds?: unknown },
) {
  const statementLineIds = idList(body.statementLineIds, 'statementLineIds')
  const journalLineIds = idList(body.journalLineIds, 'journalLineIds')

  return runRecon(actor, await reconAccountId(actor.tenantId, id), async (tx, emit) => {
    const recon = await lockOpenRecon(tx, actor, id)
    await assertNotActivelyMatched(tx, actor.tenantId, statementLineIds, journalLineIds)
    const ws = await computeWorkspace(tx, recon)
    const openBank = new Map(ws.unmatchedBank.map((b) => [b.id, b]))
    const openBook = new Map(ws.unmatchedBook.map((b) => [b.id, b]))
    const bankItems = statementLineIds.map((sid) => openBank.get(sid))
    const bookItems = journalLineIds.map((jid) => openBook.get(jid))
    if (bankItems.some((b) => !b) || bookItems.some((b) => !b)) {
      throw new ApiError(404, 'One or more items are not open items of this reconciliation')
    }
    const bankTotal = sum(bankItems.map((b) => b!.amount))
    const bookTotal = sum(bookItems.map((b) => b!.amount))
    if (!bankTotal.equals(bookTotal)) {
      throw new ApiError(400, `Matched totals differ: bank ${money(bankTotal)}, book ${money(bookTotal)}`)
    }
    const match = await createMatch(tx, actor, recon, BankMatchType.MANUAL, bankItems as BankItem[], bookItems as BookItem[])
    await emit({
      bankAccountId: recon.bankAccountId,
      reconciliationId: id,
      action: 'bank_recon.matched',
      metadata: { matchId: match.id, statementLineIds, journalLineIds, total: money(bankTotal) },
    })
    return { matchId: match.id, type: match.type, total: money(bankTotal), statementLineIds, journalLineIds }
  })
}

export async function autoMatch(actor: ReconActor, id: string, body: { dateWindowDays?: unknown } = {}) {
  const override = parseWindow(body.dateWindowDays)
  return runRecon(actor, await reconAccountId(actor.tenantId, id), async (tx, emit) => {
    const recon = await lockOpenRecon(tx, actor, id)
    const window = override ?? recon.dateWindowDays
    const ws = await computeWorkspace(tx, recon)
    const plan = planAutoMatches(ws.unmatchedBank, ws.unmatchedBook, window)
    const matchIds: string[] = []
    for (const p of plan.pairs) {
      const b = ws.bankById.get(p.statementLineId)!
      const k = ws.bookById.get(p.journalLineId)!
      const m = await createMatch(tx, actor, recon, BankMatchType.AUTO, [b], [k])
      matchIds.push(m.id)
    }
    await emit({
      bankAccountId: recon.bankAccountId,
      reconciliationId: id,
      action: 'bank_recon.auto_matched',
      metadata: {
        dateWindowDays: window,
        matched: plan.pairs.length,
        matchIds,
        ambiguousStatementLineIds: plan.ambiguousStatementLineIds,
        ambiguousJournalLineIds: plan.ambiguousJournalLineIds,
      },
    })
    return {
      dateWindowDays: window,
      matched: plan.pairs.length,
      matches: plan.pairs.map((p, i) => ({ matchId: matchIds[i], ...p })),
      ambiguousStatementLineIds: plan.ambiguousStatementLineIds,
      ambiguousJournalLineIds: plan.ambiguousJournalLineIds,
    }
  })
}

export async function unmatch(actor: ReconActor, id: string, matchId: string, body: { reason?: unknown } = {}) {
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) || null : null
  return runRecon(actor, await reconAccountId(actor.tenantId, id), async (tx, emit) => {
    const recon = await lockOpenRecon(tx, actor, id)
    const match = await tx.bankReconciliationMatch.findFirst({
      where: { id: matchId, tenantId: actor.tenantId, reconciliationId: id },
      include: { items: true },
    })
    if (!match) throw new ApiError(404, 'Match not found in this reconciliation')
    if (match.unmatchedAt) throw new ApiError(409, 'Match was already undone')
    const res = await tx.bankReconciliationMatch.updateMany({
      where: { id: matchId, tenantId: actor.tenantId, unmatchedAt: null },
      data: { unmatchedAt: new Date(), unmatchedById: actor.userId, unmatchReason: reason },
    })
    if (res.count !== 1) throw new ApiError(409, 'Match was already undone')
    await tx.bankReconciliationMatchItem.updateMany({
      where: { tenantId: actor.tenantId, matchId },
      data: { activeStatementLineId: null, activeJournalLineId: null },
    })
    const lineIds = match.items.map((i) => i.statementLineId).filter((x): x is string => !!x)
    await emit({
      bankAccountId: recon.bankAccountId,
      reconciliationId: id,
      action: 'bank_recon.unmatched',
      metadata: {
        matchId,
        reason,
        statementLineIds: lineIds,
        journalLineIds: match.items.map((i) => i.journalLineId).filter(Boolean),
      },
    })
    return { matchId, unmatched: true }
  })
}

// ---------------------------------------------------------------------------------------------
// Sign-off and reopen

export async function signOff(actor: ReconActor, id: string, body: { version?: unknown }) {
  if (typeof body.version !== 'number' || !Number.isInteger(body.version)) {
    throw new ApiError(400, 'version is required (the reconciliation version you reviewed)')
  }
  const version = body.version
  return runRecon(
    actor,
    await reconAccountId(actor.tenantId, id),
    async (tx, emit) => {
      const recon = await findRecon(tx, actor.tenantId, id)
      if (recon.status === BankReconciliationStatus.SIGNED_OFF) throw new ApiError(409, 'This period is already signed off')
      if (recon.version !== version) throw new ApiError(409, 'The reconciliation changed since you reviewed it; reload and retry')
      if (RECON_RULES.requireDistinctSigner && (actor.userId === recon.createdById || actor.userId === recon.preparedById)) {
        throw new ApiError(403, 'The signer must be a different person from the preparer')
      }
      if (RECON_RULES.requirePriorPeriodSignedOff) {
        const prior = await tx.bankReconciliation.findFirst({
          where: { tenantId: actor.tenantId, bankAccountId: recon.bankAccountId, periodEnd: { lt: recon.periodStart } },
          orderBy: { periodEnd: 'desc' },
        })
        if (prior && prior.status !== BankReconciliationStatus.SIGNED_OFF) {
          throw new ApiError(409, 'The previous period must be signed off first')
        }
      }
      const ws = await computeWorkspace(tx, recon)
      const blockers = signOffBlockers(recon, ws)
      if (blockers.length) throw new ApiError(409, blockers[0]!, undefined, blockers)

      const now = new Date()
      const res = await tx.bankReconciliation.updateMany({
        where: { id, tenantId: actor.tenantId, version, status: { not: BankReconciliationStatus.SIGNED_OFF } },
        data: {
          status: BankReconciliationStatus.SIGNED_OFF,
          signedOffById: actor.userId,
          signedOffAt: now,
          bookBalanceSnapshot: ws.balances.bookBalance,
          adjustedBookSnapshot: ws.balances.adjustedBook,
          adjustedBankSnapshot: ws.balances.adjustedBank,
          version: { increment: 1 },
        },
      })
      if (res.count !== 1) throw new ApiError(409, 'The reconciliation changed since you reviewed it; reload and retry')
      const locked = await tx.bankStatementLine.updateMany({
        where: { tenantId: actor.tenantId, bankAccountId: recon.bankAccountId, postedAt: { lt: ws.endExcl }, lockedAt: null },
        data: { lockedAt: now },
      })
      await emit({
        bankAccountId: recon.bankAccountId,
        reconciliationId: id,
        action: 'bank_recon.signed_off',
        metadata: {
          preparedById: recon.preparedById,
          balances: Object.fromEntries(Object.entries(ws.balances).map(([k, v]) => [k, money(v)])),
          lockedLines: locked.count,
        },
      })
      return serializeRecon(await tx.bankReconciliation.findFirstOrThrow({ where: { id, tenantId: actor.tenantId } }))
    },
    { serializable: true },
  )
}

export async function reopen(actor: ReconActor, id: string, body: { reason?: unknown }) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 5) throw new ApiError(400, 'A reason of at least 5 characters is required to reopen')
  if (reason.length > 1000) throw new ApiError(400, 'Reason is longer than 1000 characters')
  return runRecon(
    actor,
    await reconAccountId(actor.tenantId, id),
    async (tx, emit) => {
      const recon = await findRecon(tx, actor.tenantId, id)
      if (recon.status !== BankReconciliationStatus.SIGNED_OFF) throw new ApiError(409, 'Only a signed-off period can be reopened')
      const later = await tx.bankReconciliation.findFirst({
        where: {
          tenantId: actor.tenantId,
          bankAccountId: recon.bankAccountId,
          status: BankReconciliationStatus.SIGNED_OFF,
          periodEnd: { gt: recon.periodEnd },
        },
        select: { id: true },
      })
      if (later) throw new ApiError(409, 'Reopen the later signed-off periods of this account first')
      const prev = await tx.bankReconciliation.findFirst({
        where: {
          tenantId: actor.tenantId,
          bankAccountId: recon.bankAccountId,
          status: BankReconciliationStatus.SIGNED_OFF,
          periodEnd: { lt: recon.periodStart },
        },
        orderBy: { periodEnd: 'desc' },
        select: { periodEnd: true },
      })
      const res = await tx.bankReconciliation.updateMany({
        where: { id, tenantId: actor.tenantId, version: recon.version, status: BankReconciliationStatus.SIGNED_OFF },
        data: {
          status: BankReconciliationStatus.IN_PROGRESS,
          signedOffById: null,
          signedOffAt: null,
          bookBalanceSnapshot: null,
          adjustedBookSnapshot: null,
          adjustedBankSnapshot: null,
          reopenedCount: { increment: 1 },
          version: { increment: 1 },
        },
      })
      if (res.count !== 1) throw new ApiError(409, 'The reconciliation changed at the same time; reload and retry')
      const endExcl = addDays(recon.periodEnd, 1)
      const unlocked = await tx.bankStatementLine.updateMany({
        where: {
          tenantId: actor.tenantId,
          bankAccountId: recon.bankAccountId,
          lockedAt: { not: null },
          postedAt: { lt: endExcl, ...(prev ? { gte: addDays(prev.periodEnd, 1) } : {}) },
        },
        data: { lockedAt: null },
      })
      const snap = (d: Prisma.Decimal | null) => (d === null ? null : money(dec(d)))
      await emit({
        bankAccountId: recon.bankAccountId,
        reconciliationId: id,
        action: 'bank_recon.reopened',
        metadata: {
          reason,
          previousSignedOffById: recon.signedOffById,
          previousSignedOffAt: recon.signedOffAt?.toISOString() ?? null,
          previousSnapshot: {
            bookBalance: snap(recon.bookBalanceSnapshot),
            adjustedBook: snap(recon.adjustedBookSnapshot),
            adjustedBank: snap(recon.adjustedBankSnapshot),
          },
          unlockedLines: unlocked.count,
        },
      })
      return serializeRecon(await tx.bankReconciliation.findFirstOrThrow({ where: { id, tenantId: actor.tenantId } }))
    },
    { serializable: true },
  )
}

/** Workspace plus the facts the PDF needs; used by the PDF route. */
export async function getReconciliationReport(tenantId: string, id: string) {
  const workspace = await getReconciliationWorkspace(tenantId, id)
  const snapshotMismatch =
    workspace.reconciliation.status === BankReconciliationStatus.SIGNED_OFF &&
    (workspace.reconciliation.snapshot.adjustedBook !== workspace.balances.adjustedBook ||
      workspace.reconciliation.snapshot.adjustedBank !== workspace.balances.adjustedBank)
  return { workspace, snapshotMismatch }
}
