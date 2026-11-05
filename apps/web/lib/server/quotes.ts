import { CounterOfferSide, Prisma, QuoteOrigin, QuoteStatus } from '@/generated/prisma-storefront'
import { storefrontDb } from './db'
import { money } from './money'
import { ApiError } from './session'
import * as crm from './crm'
import * as inv from './inventory'
import * as orders from './orders'

export async function listQuotes(tenantId: string, status?: string, opts?: { buyerCustomerId?: string }) {
  const st = status as QuoteStatus | undefined
  const rows = await storefrontDb.b2BQuote.findMany({
    where: {
      tenantId,
      ...(st ? { status: st } : {}),
      ...(opts?.buyerCustomerId ? { customerRef: opts.buyerCustomerId } : {}),
    },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })
  const customerIds = [...new Set(rows.map((r) => r.customerRef))]
  const { crmDb } = await import('./db')
  const customers =
    customerIds.length > 0
      ? await crmDb.customer.findMany({ where: { tenantId, id: { in: customerIds } } })
      : []
  const custMap = new Map(customers.map((c) => [c.id, c.name]))

  return rows.map((r) => ({
    ...r,
    customerName: custMap.get(r.customerRef) ?? r.customerRef,
    quoteNumber: `Q-${r.id.slice(-8).toUpperCase()}`,
  }))
}

export async function getQuote(tenantId: string, id: string, opts?: { buyerCustomerId?: string }) {
  const row = await storefrontDb.b2BQuote.findFirst({
    where: { id, tenantId },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  })
  if (!row) throw new ApiError(404, 'Quote not found')
  if (opts?.buyerCustomerId && row.customerRef !== opts.buyerCustomerId) {
    throw new ApiError(404, 'Quote not found')
  }
  const { crmDb } = await import('./db')
  const cust = await crmDb.customer.findFirst({ where: { tenantId, id: row.customerRef } })
  return {
    ...row,
    customerName: cust?.name ?? row.customerRef,
    quoteNumber: `Q-${row.id.slice(-8).toUpperCase()}`,
  }
}

/**
 * Who is creating a quote, and from where. Always built by the server from the authenticated session (or the
 * rep viewer), never from the request body. Without it the quote is stored like a legacy one: no recorded creator.
 */
export type QuoteActor = { userId: string; via: QuoteOrigin }

export async function createQuote(
  tenantId: string,
  dto: { customerRef: string; notes?: string; lines: Array<{ lineNo: number; skuCode?: string; description: string; qty: number; unitPrice: number }> },
  opts?: { buyerCustomerId?: string; actor?: QuoteActor },
) {
  if (opts?.buyerCustomerId && dto.customerRef !== opts.buyerCustomerId) {
    throw new ApiError(403, 'Cannot create quotes for another customer')
  }
  await crm.assertCustomerCanTransact(tenantId, dto.customerRef)
  if (!Array.isArray(dto.lines) || dto.lines.length === 0) throw new ApiError(400, 'A quote needs at least one line')
  const seqs = new Set(dto.lines.map((l) => l.lineNo))
  if (seqs.size !== dto.lines.length) throw new ApiError(400, 'Duplicate line numbers')
  await resolveQuoteCustomerId(tenantId, dto.customerRef)
  // Every line names a real product up front, so an approved quote can always become an order (ticket 55).
  const lines = []
  for (const l of dto.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new ApiError(400, `Line ${l.lineNo}: quantity must be a whole number of 1 or more`)
    if (typeof l.unitPrice !== 'number' || !Number.isFinite(l.unitPrice) || l.unitPrice < 0) {
      throw new ApiError(400, `Line ${l.lineNo}: unit price must be 0 or more`)
    }
    const sku = await quoteLineSku(tenantId, l.lineNo, l.skuCode)
    lines.push({
      lineNo: l.lineNo,
      skuCode: sku.code,
      description: l.description?.trim() || sku.name,
      qty: l.qty,
      unitPrice: new Prisma.Decimal(String(l.unitPrice)),
    })
  }
  return storefrontDb.b2BQuote.create({
    data: {
      tenantId,
      customerRef: dto.customerRef,
      notes: dto.notes,
      status: QuoteStatus.OPEN,
      // Only from opts.actor: dto is the request body and may carry anything.
      createdByUserId: opts?.actor?.userId ?? null,
      createdVia: opts?.actor?.via ?? null,
      lines: { create: lines },
    },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  })
}

/** Points between a status change's read and its write, where tests can slot in a competing change. */
export type QuoteRacePoint =
  | 'request-approval:after-read'
  | 'approve:after-read'
  | 'reject:after-read'
  | 'submit:after-read'
  | 'submit:after-claim'
  | 'submit:after-create'
  | 'submit:order-lookup'
  | 'submit:resume'
  | 'accept:after-read'
  | 'counter:after-read'
  | 'edit:after-read'
  | 'withdraw:after-read'
let raceHook: ((point: QuoteRacePoint, quoteId: string) => Promise<void> | void) | null = null

/** Tests only: run `hook` at each race point. Pass null to remove it. Does nothing in production. */
export function setQuoteRaceHookForTests(hook: typeof raceHook) {
  raceHook = hook
}

const QUOTE_CHANGED = 'This quote was changed at the same time by someone else. Reload it and try again.'

/** 409 when the caller says which version they looked at and the quote has moved on since. */
function assertExpectedVersion(q: { version: number }, expectedVersion: number | undefined) {
  if (expectedVersion !== undefined && expectedVersion !== q.version) throw new ApiError(409, QUOTE_CHANGED)
}

/**
 * Applies one status change only if the quote is still exactly as it was read: same tenant, status and version.
 * The version goes up by one with the change, so any other change made after the read (a decision, a resubmission,
 * a second click) makes this write miss and answer 409 instead of silently overwriting it.
 */
async function guardedTransition(
  tenantId: string,
  read: { id: string; status: QuoteStatus; version: number },
  data: Prisma.B2BQuoteUpdateManyMutationInput,
  /** More writes that commit (or roll back) together with the transition, run only once it has landed. */
  alsoInTx?: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  return storefrontDb.$transaction(async (tx) => {
    const res = await tx.b2BQuote.updateMany({
      where: { id: read.id, tenantId, status: read.status, version: read.version },
      data: { ...data, version: { increment: 1 } },
    })
    if (res.count !== 1) {
      const now = await tx.b2BQuote.findFirst({ where: { id: read.id, tenantId }, select: { id: true } })
      if (!now) throw new ApiError(404, 'Quote not found')
      throw new ApiError(409, QUOTE_CHANGED)
    }
    await alsoInTx?.(tx)
    return tx.b2BQuote.findFirstOrThrow({
      where: { id: read.id, tenantId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    })
  })
}

export async function requestQuoteApproval(
  tenantId: string,
  id: string,
  opts?: { buyerCustomerId?: string },
) {
  const q = await getQuote(tenantId, id, opts)
  if (q.status !== QuoteStatus.OPEN && q.status !== QuoteStatus.REJECTED) {
    throw new ApiError(400, `Cannot request approval from status ${q.status}`)
  }
  await raceHook?.('request-approval:after-read', id)
  return guardedTransition(tenantId, q, { status: QuoteStatus.PENDING_APPROVAL, rejectionReason: null })
}

/** The active SKU a quote line is for; a line without one can't become an order. */
async function quoteLineSku(tenantId: string, lineNo: number, skuCode: string | null | undefined) {
  const code = skuCode?.trim()
  if (!code) throw new ApiError(400, `Line ${lineNo}: choose a product (SKU)`)
  const { inventoryDb } = await import('./db')
  const sku = await inventoryDb.sKU.findFirst({ where: { tenantId, code: { equals: code } } })
  if (!sku) throw new ApiError(400, `Line ${lineNo}: no product with SKU ${code}`)
  if (!sku.isActive) throw new ApiError(400, `Line ${lineNo}: product ${code} is inactive`)
  return sku
}

/** The customer a quote is for: its customerRef is a customer id, or (older quotes) a customer's external reference. */
async function resolveQuoteCustomerId(tenantId: string, customerRef: string): Promise<string> {
  const ref = customerRef?.trim()
  if (!ref) throw new ApiError(400, 'A quote needs a customer')
  const { crmDb } = await import('./db')
  const byId = await crmDb.customer.findFirst({ where: { tenantId, id: ref }, select: { id: true } })
  if (byId) return byId.id
  const byRef = await crm.findCustomerByExternalRef(tenantId, ref)
  if (byRef) return byRef.id
  throw new ApiError(400, `No customer matches the quote's customer (${ref})`)
}

/**
 * Approves the quote as it was read and checked. `expectedVersion` (optional) is the version the approver was
 * looking at: if the quote changed since, they are told to reload instead of approving content they never saw.
 */
export async function approveQuote(tenantId: string, id: string, approvedByUserId: string, opts?: { expectedVersion?: number }) {
  const q = await getQuote(tenantId, id)
  if (q.status !== QuoteStatus.PENDING_APPROVAL) {
    throw new ApiError(400, 'Only pending quotes can be approved')
  }
  assertExpectedVersion(q, opts?.expectedVersion)
  // A quote that couldn't become an order must not be approvable (ticket 55).
  try {
    await resolveQuoteCustomerId(tenantId, q.customerRef)
    for (const line of q.lines) await quoteLineSku(tenantId, line.lineNo, line.skuCode)
  } catch (e) {
    if (e instanceof ApiError) throw new ApiError(400, `This quote can't be approved yet. ${e.message}`)
    throw e
  }
  await raceHook?.('approve:after-read', id)
  // The write only lands on the exact version checked above, so the approved lines are the ones validated here.
  // Approved terms are final (Phase 4), so offers still open on the quote can never be accepted: they are marked
  // SUPERSEDED in the same transaction, kept with their lines as negotiation history.
  return guardedTransition(
    tenantId,
    q,
    {
      status: QuoteStatus.APPROVED,
      approvedAt: new Date(),
      approvedByUserId,
      rejectionReason: null,
    },
    (tx) => supersedeOpenOffers(tx, id),
  )
}

export async function rejectQuote(tenantId: string, id: string, reason: string, opts?: { expectedVersion?: number }) {
  const q = await getQuote(tenantId, id)
  if (q.status !== QuoteStatus.PENDING_APPROVAL) {
    throw new ApiError(400, 'Only pending quotes can be rejected')
  }
  if (!reason?.trim()) throw new ApiError(400, 'reason is required')
  assertExpectedVersion(q, opts?.expectedVersion)
  await raceHook?.('reject:after-read', id)
  return guardedTransition(tenantId, q, { status: QuoteStatus.REJECTED, rejectionReason: reason.trim() })
}

type QuoteLineSnapshot = { lineNo: number; skuCode: string | null; qty: number; unitPrice: Prisma.Decimal | number | string }

async function quoteToOrderLines(tenantId: string, lines: QuoteLineSnapshot[]) {
  const warehouses = await inv.listWarehouses(tenantId)
  if (warehouses.length === 0) {
    throw new ApiError(400, 'No warehouses found — create a warehouse before submitting quotes.')
  }
  const defaultWh = warehouses.find((w) => w.isDefault) ?? warehouses[0]
  const lineItems: Array<{ skuId: string; warehouseId: string; quantity: number; unitPrice: number }> = []
  for (const line of [...lines].sort((a, b) => a.lineNo - b.lineNo)) {
    const sku = await quoteLineSku(tenantId, line.lineNo, line.skuCode)
    lineItems.push({
      skuId: sku.id,
      warehouseId: defaultWh.id,
      quantity: line.qty,
      unitPrice: Number(line.unitPrice),
    })
  }
  return lineItems
}

/**
 * Turns an approved quote into an order at the approved prices, placed by the buyer (their own quote) or by
 * staff ("Create order from quote"). The quote's customer is the order's customer; the approval is what
 * authorises its prices, so they are not checked against the price list again (ticket 55).
 */
/**
 * How long a conversion claim (SUBMITTED, no order linked, no order found) is left to the request that made it
 * before a retry may take it over. Timing only: correctness comes from the version-guarded claim and the order
 * database's one-order-per-quote index, so a takeover can never produce a second order.
 */
export const CONVERSION_RECOVERY_MS = 2 * 60_000

type SubmitOpts = { buyerCustomerId?: string; userId?: string }
type ClaimedQuote = { id: string; version: number; notes: string | null; customerRef: string; lines: QuoteLineSnapshot[] }

const CONVERSION_UNCONFIRMED =
  'The order could not be confirmed because the order database is unavailable. Nothing will be ordered twice: try again in a few minutes.'

/** Looks the quote's order up in the order database. A failure here means "unknown", never "no order". */
async function lookupConvertedOrder(tenantId: string, quoteId: string) {
  try {
    await raceHook?.('submit:order-lookup', quoteId)
    return await orders.findOrderBySourceQuote(tenantId, quoteId)
  } catch (e) {
    console.error(`[quotes] could not check the order database for quote ${quoteId}:`, e)
    throw new ApiError(503, CONVERSION_UNCONFIRMED)
  }
}

/**
 * Records the quote's order. Idempotent: applies only while no order is linked. A quote still APPROVED is accepted
 * too: that is a quote whose claim was released while its order insert was still in flight (see takeover).
 */
async function linkConvertedOrder(tenantId: string, id: string, orderId: string, opts?: SubmitOpts) {
  await storefrontDb.b2BQuote.updateMany({
    where: { id, tenantId, convertedOrderId: null, status: { in: [QuoteStatus.SUBMITTED, QuoteStatus.APPROVED] } },
    data: { status: QuoteStatus.SUBMITTED, convertedOrderId: orderId, version: { increment: 1 } },
  })
  return getQuote(tenantId, id, opts)
}

/**
 * The quote's order exists but this request did not place it (or placing it stopped part-way): finish whatever
 * placement left undone — credit approval request, fulfilment, webhook, email — through orders.resumeOrderPlacement,
 * whose every step is idempotent or at-most-once. Best effort: the order is already linked, so a failure here is
 * logged for an operator and never fails or changes the answer to the request.
 */
async function resumeOrderSideEffects(tenantId: string, quoteId: string, orderId: string) {
  try {
    await raceHook?.('submit:resume', quoteId)
    const report = await orders.resumeOrderPlacement(tenantId, orderId)
    if (report.limitations.length > 0) {
      console.warn(
        `[quotes] tenant ${tenantId}: order ${orderId} for quote ${quoteId} was not fully resumed ` +
          `(status ${report.status}, pipeline ${report.pipeline}, credit approval ${report.creditApproval}, ` +
          `webhook ${report.event}, email ${report.email}): ${report.limitations.join(' ')}`,
      )
    }
  } catch (e) {
    console.error(`[quotes] tenant ${tenantId}: could not resume order ${orderId} for quote ${quoteId}:`, e)
  }
}

/**
 * Moves the quote from `fromStatus` at exactly `version` to SUBMITTED (version + 1) and, in the same storefront
 * transaction, reads back the lines of that claimed version. Those lines are what the order is built from. Returns
 * null when the quote changed since it was read (another claim, an edit, a decision): nothing is ordered then.
 */
async function claimForConversion(tenantId: string, id: string, fromStatus: QuoteStatus, version: number): Promise<ClaimedQuote | null> {
  return storefrontDb.$transaction(async (tx) => {
    const res = await tx.b2BQuote.updateMany({
      where: { id, tenantId, status: fromStatus, version, convertedOrderId: null },
      data: { status: QuoteStatus.SUBMITTED, version: { increment: 1 } },
    })
    if (res.count !== 1) return null
    return tx.b2BQuote.findFirstOrThrow({
      where: { id, tenantId, status: QuoteStatus.SUBMITTED, version: version + 1, convertedOrderId: null },
      select: { id: true, version: true, notes: true, customerRef: true, lines: { orderBy: { lineNo: 'asc' } } },
    })
  })
}

/**
 * Places the order for a claimed quote from its claimed snapshot, then links it. The order database lets only one
 * order per quote commit; a request that loses that race links the winner's order instead of placing another.
 * If placing fails, the claim is released back to APPROVED only once the order database confirms no order exists.
 */
async function convertClaimedQuote(tenantId: string, claimed: ClaimedQuote, opts?: SubmitOpts) {
  const id = claimed.id
  let orderId: string
  try {
    const customerId = opts?.buyerCustomerId ?? (await resolveQuoteCustomerId(tenantId, claimed.customerRef))
    const lineItems = await quoteToOrderLines(tenantId, claimed.lines)
    const order = await orders.createOrder(
      tenantId,
      {
        customerId,
        channel: opts?.buyerCustomerId ? 'B2B_PORTAL' : 'SALES_REP',
        paymentMethod: 'NET_TERMS',
        notes: claimed.notes ?? `From quote Q-${id.slice(-8).toUpperCase()}`,
        lineItems,
      },
      {
        ...(opts?.buyerCustomerId ? { buyerCustomerId: opts.buyerCustomerId } : {}),
        userId: opts?.userId,
        skipPriceValidation: true,
        sourceQuoteId: id,
      },
    )
    orderId = order.id
  } catch (e) {
    if (e instanceof orders.DuplicateSourceOrderError) {
      // Another request placed it; it may still be finishing, or may have stopped part-way. Resuming is safe either way.
      const linked = await linkConvertedOrder(tenantId, id, e.orderId, opts)
      await resumeOrderSideEffects(tenantId, id, e.orderId)
      return linked
    } else {
      // An error does not prove nothing was ordered (it may come after the order was saved): ask the order database.
      const existing = await lookupConvertedOrder(tenantId, id)
      if (existing) {
        // The order exists. Link it so it is never placed twice, finish what placing it left undone, and still
        // report the original error.
        await linkConvertedOrder(tenantId, id, existing.id, opts)
        await resumeOrderSideEffects(tenantId, id, existing.id)
        throw e
      }
      // Confirmed: no order. Release this claim (only this one: same version, still unlinked) so it can be retried.
      await storefrontDb.b2BQuote.updateMany({
        where: { id, tenantId, status: QuoteStatus.SUBMITTED, version: claimed.version, convertedOrderId: null },
        data: { status: QuoteStatus.APPROVED, version: { increment: 1 } },
      })
      throw e
    }
  }
  await raceHook?.('submit:after-create', id)
  return linkConvertedOrder(tenantId, id, orderId, opts)
}

/** Links an order found in the order database (placed by an earlier request) and finishes its placement. */
async function linkAndResume(tenantId: string, id: string, orderId: string, opts?: SubmitOpts) {
  const linked = await linkConvertedOrder(tenantId, id, orderId, opts)
  await resumeOrderSideEffects(tenantId, id, orderId)
  return linked
}

/**
 * A quote that is SUBMITTED with no order linked: a conversion is in progress, or one stopped part-way (crash,
 * lost connection). The order database decides: an order for the quote is linked; with none, a fresh claim is left
 * to its owner for CONVERSION_RECOVERY_MS and taken over (re-claimed at its version, then placed) after that.
 */
async function resumeConversion(tenantId: string, q: Awaited<ReturnType<typeof getQuote>>, opts?: SubmitOpts) {
  const existing = await lookupConvertedOrder(tenantId, q.id)
  if (existing) return linkAndResume(tenantId, q.id, existing.id, opts)
  // Nothing else writes a SUBMITTED quote, so updatedAt is when it was claimed. Used for timing only.
  if (Date.now() - q.updatedAt.getTime() < CONVERSION_RECOVERY_MS) return q
  const claimed = await claimForConversion(tenantId, q.id, QuoteStatus.SUBMITTED, q.version)
  if (!claimed) return getQuote(tenantId, q.id, opts) // another retry took it over or linked it first
  await raceHook?.('submit:after-claim', q.id)
  return convertClaimedQuote(tenantId, claimed, opts)
}

/**
 * Turns an approved quote into an order at the approved prices, placed by the buyer (their own quote) or by
 * staff ("Create order from quote"). The quote's customer is the order's customer; the approval is what
 * authorises its prices, so they are not checked against the price list again (ticket 55).
 *
 * Quotes and orders live in different databases, so this is made safe without a shared transaction:
 * 1. claim: APPROVED → SUBMITTED only at the version that was read (409 if it changed), and snapshot the lines in
 *    the same storefront transaction;
 * 2. place the order from that snapshot, tagged with the quote id, which the order database allows once per tenant;
 * 3. link the order to the quote. Retries and crashes are reconciled from the order database (resumeConversion).
 */
export async function submitQuote(tenantId: string, id: string, opts?: SubmitOpts) {
  const q = await getQuote(tenantId, id, opts)
  if (q.convertedOrderId) {
    // Linked, but the request that placed it may have stopped before finishing (3B-3): a repeat finishes it.
    await resumeOrderSideEffects(tenantId, id, q.convertedOrderId)
    return q
  }
  if (q.status === QuoteStatus.SUBMITTED) return resumeConversion(tenantId, q, opts)
  if (q.status !== QuoteStatus.APPROVED) {
    throw new ApiError(400, 'Quote must be approved before placing an order')
  }
  // Fail fast, before claiming, on what would stop the order anyway (no warehouse, a product no longer sellable).
  await quoteToOrderLines(tenantId, q.lines)
  await raceHook?.('submit:after-read', id)

  // An order may already exist for an APPROVED quote if a released claim raced its own insert: link, never re-place.
  const existing = await lookupConvertedOrder(tenantId, id)
  if (existing) return linkAndResume(tenantId, id, existing.id, opts)

  const claimed = await claimForConversion(tenantId, id, QuoteStatus.APPROVED, q.version)
  if (!claimed) {
    const now = await getQuote(tenantId, id, opts)
    // Another request claimed or placed it first: report it as it stands, as before.
    if (now.convertedOrderId || now.status === QuoteStatus.SUBMITTED) return now
    throw new ApiError(409, 'The quote changed while placing the order; reload and try again')
  }
  await raceHook?.('submit:after-claim', id)
  return convertClaimedQuote(tenantId, claimed, opts)
}

/**
 * Counter-offer statuses (a plain string column). OPEN can be accepted; ACCEPTED is the one whose terms the quote
 * took; SUPERSEDED was still open when another offer was accepted or the quote was approved, so it can never be
 * accepted. Rows are never deleted: they are the quote's negotiation history.
 */
export const OFFER_OPEN = 'OPEN'
export const OFFER_ACCEPTED = 'ACCEPTED'
export const OFFER_SUPERSEDED = 'SUPERSEDED'

/** Marks every still-open offer on the quote (but `exceptId`) SUPERSEDED. Runs inside the caller's transaction. */
function supersedeOpenOffers(tx: Prisma.TransactionClient, quoteId: string, exceptId?: string) {
  return tx.quoteCounterOffer.updateMany({
    where: { quoteId, status: OFFER_OPEN, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { status: OFFER_SUPERSEDED },
  })
}

/**
 * The quote's counter-offers, newest first. For buyers (`forBuyer`), the user ids of who made and accepted each
 * offer are left out: they are internal (staff, or another login of the customer) and no buyer screen uses them.
 */
export async function listQuoteCounterOffers(tenantId: string, quoteId: string, opts?: { forBuyer?: boolean }) {
  await getQuote(tenantId, quoteId)
  const rows = await storefrontDb.quoteCounterOffer.findMany({
    where: { quoteId },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })
  if (!opts?.forBuyer) return rows
  return rows.map(({ userId: _userId, acceptedByUserId: _acceptedBy, ...shown }) => shown)
}

/** Who is making or accepting a counter-offer. Built by the route from the authenticated session, never the body. */
export type CounterOfferActor = { userId: string; side: CounterOfferSide }

/**
 * Quote statuses on which counter-offers may be made and accepted. APPROVED is final (Ticket #3, Phase 4): changing
 * an approved quote's terms needs a new quote. SUBMITTED, EXPIRED, WITHDRAWN and converted quotes never change.
 */
const COUNTER_ELIGIBLE: QuoteStatus[] = [QuoteStatus.OPEN, QuoteStatus.PENDING_APPROVAL, QuoteStatus.REJECTED]
const QUOTE_LOCKED_FOR_ORDER = 'This quote is being turned into an order or already has one, so it can no longer be changed.'
const APPROVED_IS_FINAL = 'This quote is approved, so its terms are final. Create a new quote to negotiate different terms.'
const APPROVED_MEANWHILE = 'This quote was approved at the same time, so its terms are now final. Reload it.'
const NOT_COUNTERPARTY = "You can't accept an offer made by your own side. The other party has to accept it."
const LEGACY_OFFER =
  "This counter-offer was made before offers recorded who sent them, so it can't be accepted safely. Ask for it to be sent again."

/** Largest unit price on an offer line, and the most decimal places it may carry. */
const MAX_OFFER_UNIT_PRICE = new Prisma.Decimal('1000000000')
const MAX_PRICE_DECIMALS = 4
const MAX_OFFER_NOTES = 2000
const DECIMAL_STRING = /^\d+(\.\d+)?$/

/** The display label existing clients read ("BUYER" / "ADMIN"), from the server-controlled side. */
const offeredByLabel = (side: CounterOfferSide) => (side === CounterOfferSide.BUYER ? 'BUYER' : 'ADMIN')

/** The actor's side must match how the route resolved them: a portal buyer is BUYER, anyone else STAFF. */
function assertActor(actor: CounterOfferActor | undefined, buyerCustomerId: string | undefined): CounterOfferActor {
  if (!actor?.userId) throw new ApiError(401, 'Sign in to continue')
  const expected = buyerCustomerId ? CounterOfferSide.BUYER : CounterOfferSide.STAFF
  if (actor.side !== expected) throw new ApiError(403, 'Forbidden')
  return actor
}

function parseUnitPrice(raw: unknown, lineNo: number, opts?: { allowZero?: boolean }): Prisma.Decimal {
  let price: Prisma.Decimal
  // The shortest decimal string for a JSON number, so 19.5 is 19.5 exactly; never rounded (money() keeps every place).
  if (typeof raw === 'number' && Number.isFinite(raw)) price = money(String(raw))
  else if (typeof raw === 'string' && DECIMAL_STRING.test(raw.trim())) price = money(raw.trim())
  else throw new ApiError(400, `Line ${lineNo}: unit price must be a number, such as 19 or 19.50`)
  // Counter-offers need a price above 0; a buyer's own quote lines may be 0, as quote creation allows.
  if (opts?.allowZero ? price.isNegative() : !price.gt(0)) {
    throw new ApiError(400, `Line ${lineNo}: unit price must be ${opts?.allowZero ? '0 or more' : 'greater than 0'}`)
  }
  if (price.gt(MAX_OFFER_UNIT_PRICE)) throw new ApiError(400, `Line ${lineNo}: unit price is too large`)
  if (price.decimalPlaces() > MAX_PRICE_DECIMALS) {
    throw new ApiError(400, `Line ${lineNo}: unit price can have at most ${MAX_PRICE_DECIMALS} decimal places`)
  }
  return price
}

type OfferLine = { lineNo: number; qty: number; unitPrice: Prisma.Decimal }

/**
 * Validates offer lines against the quote they are for. An offer only changes quantities and prices of the quote's
 * own lines: each line number must be on the quote, appear once, and still name an active product of this tenant.
 * Leaving a quote line out drops it when the offer is accepted (as before). Run on create and again on accept.
 */
async function validateOfferLines(
  tenantId: string,
  quote: { lines: Array<{ lineNo: number; skuCode: string | null }> },
  raw: unknown,
): Promise<OfferLine[]> {
  if (!Array.isArray(raw) || raw.length === 0) throw new ApiError(400, 'At least one line required')
  const onQuote = new Map(quote.lines.map((l) => [l.lineNo, l]))
  if (raw.length > onQuote.size) throw new ApiError(400, "A counter-offer can't have more lines than the quote")
  const seen = new Set<number>()
  const lines: OfferLine[] = []
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== 'object') throw new ApiError(400, `Line ${i + 1}: must be an object`)
    const { lineNo, qty, unitPrice } = item as Record<string, unknown>
    if (typeof lineNo !== 'number' || !Number.isInteger(lineNo) || lineNo < 1) {
      throw new ApiError(400, `Line ${i + 1}: lineNo must be a whole number of 1 or more`)
    }
    if (seen.has(lineNo)) throw new ApiError(400, `Line ${lineNo} appears more than once`)
    seen.add(lineNo)
    const quoteLine = onQuote.get(lineNo)
    if (!quoteLine) throw new ApiError(400, `Line ${lineNo} is not on this quote`)
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > orders.MAX_LINE_QUANTITY) {
      throw new ApiError(400, `Line ${lineNo}: quantity must be a whole number from 1 to ${orders.MAX_LINE_QUANTITY}`)
    }
    const price = parseUnitPrice(unitPrice, lineNo)
    await quoteLineSku(tenantId, lineNo, quoteLine.skuCode) // the product still exists in this tenant and is sellable
    lines.push({ lineNo, qty, unitPrice: price })
  }
  return lines.sort((a, b) => a.lineNo - b.lineNo)
}

/** 400 for a status that never takes counter-offers; 409 when accepting on a quote locked by or for an order. */
function assertCounterEligible(q: { status: QuoteStatus; convertedOrderId: string | null }, action: 'make' | 'accept') {
  if (q.convertedOrderId || q.status === QuoteStatus.SUBMITTED) {
    if (action === 'accept') throw new ApiError(409, QUOTE_LOCKED_FOR_ORDER)
    throw new ApiError(400, 'Cannot counter-offer on this quote')
  }
  if (q.status === QuoteStatus.APPROVED) throw new ApiError(400, APPROVED_IS_FINAL)
  if (!COUNTER_ELIGIBLE.includes(q.status)) {
    if (action === 'accept') throw new ApiError(409, `This quote is ${q.status.toLowerCase()} and can no longer be changed.`)
    throw new ApiError(400, 'Cannot counter-offer on this quote')
  }
}

/**
 * A counter-offer on a quote, by the buyer (their own quote) or by staff. Who made it comes only from `opts.actor`
 * (the session): `offeredBy`, `userId` or anything else in the body about identity is ignored.
 */
export async function createQuoteCounterOffer(
  tenantId: string,
  quoteId: string,
  dto: { offeredBy?: unknown; userId?: unknown; notes?: unknown; lines?: unknown },
  opts: { buyerCustomerId?: string; actor: CounterOfferActor },
) {
  const actor = assertActor(opts.actor, opts.buyerCustomerId)
  const q = await getQuote(tenantId, quoteId, opts)
  assertCounterEligible(q, 'make')
  if (dto.notes !== undefined && dto.notes !== null && typeof dto.notes !== 'string') throw new ApiError(400, 'notes must be text')
  const notes = typeof dto.notes === 'string' && dto.notes.trim() ? dto.notes.trim() : undefined
  if (notes && notes.length > MAX_OFFER_NOTES) throw new ApiError(400, `notes can be at most ${MAX_OFFER_NOTES} characters`)
  await crm.assertCustomerCanTransact(tenantId, q.customerRef)
  const lines = await validateOfferLines(tenantId, q, dto.lines)
  await raceHook?.('counter:after-read', quoteId)

  return storefrontDb.$transaction(async (tx) => {
    // Only while the quote is still as validated: an approval or conversion in between makes this miss, so no
    // offer is ever left on an approved or submitted quote. The quote's terms and version are not changed.
    const still = await tx.b2BQuote.updateMany({
      where: { id: quoteId, tenantId, status: { in: COUNTER_ELIGIBLE }, version: q.version, convertedOrderId: null },
      data: { updatedAt: new Date() },
    })
    if (still.count !== 1) {
      const now = await tx.b2BQuote.findFirst({ where: { id: quoteId, tenantId }, select: { status: true } })
      if (now?.status === QuoteStatus.APPROVED) throw new ApiError(409, APPROVED_MEANWHILE)
      throw new ApiError(409, QUOTE_CHANGED)
    }
    return tx.quoteCounterOffer.create({
      data: {
        quoteId,
        side: actor.side,
        offeredBy: offeredByLabel(actor.side),
        userId: actor.userId,
        notes,
        lines: { create: lines.map((l) => ({ lineNo: l.lineNo, qty: l.qty, unitPrice: l.unitPrice })) },
      },
      include: { lines: true },
    })
  })
}

/**
 * Only the other party may accept. New offers carry a server-set side. Legacy offers (side null) have only the
 * client-supplied label, which a buyer could have forged as ADMIN: buyers can never accept one, and staff only one
 * labelled BUYER (staff's counterparty, whatever its true origin). Anything else must be sent again.
 */
function assertCounterparty(offer: { side: CounterOfferSide | null; offeredBy: string }, actor: CounterOfferActor) {
  if (offer.side) {
    if (offer.side === actor.side) throw new ApiError(403, NOT_COUNTERPARTY)
    return
  }
  if (actor.side === CounterOfferSide.BUYER || offer.offeredBy !== 'BUYER') throw new ApiError(400, LEGACY_OFFER)
}

/**
 * Accepts an open counter-offer for the other party: the quote's lines become the offer's quantities and prices,
 * the offer becomes ACCEPTED (with who and when), and the quote goes back to OPEN at version + 1, all in one
 * storefront transaction guarded on the version that was read. Of two acceptances, or an approval or a conversion
 * racing one, exactly one lands; the others get 409 and change nothing.
 */
export async function acceptQuoteCounterOffer(
  tenantId: string,
  quoteId: string,
  counterOfferId: string,
  opts: { buyerCustomerId?: string; actor: CounterOfferActor },
) {
  const actor = assertActor(opts.actor, opts.buyerCustomerId)
  // The quote first: tenant and customer scope decide whether this caller may learn anything about it.
  const before = await getQuote(tenantId, quoteId, opts)
  const offer = await storefrontDb.quoteCounterOffer.findFirst({
    where: { id: counterOfferId, quoteId },
    include: { lines: true },
  })
  if (!offer) throw new ApiError(404, 'Counter offer not found')
  if (offer.status === OFFER_SUPERSEDED) {
    throw new ApiError(400, 'This counter-offer was replaced: another offer was accepted or the quote was approved.')
  }
  if (offer.status !== OFFER_OPEN) throw new ApiError(400, 'Counter offer is not open')
  assertCounterparty(offer, actor)
  assertCounterEligible(before, 'accept')
  // Checked again: legacy offers were never validated, and a product can be retired after the offer was made.
  const lines = await validateOfferLines(
    tenantId,
    before,
    offer.lines.map((l) => ({ lineNo: l.lineNo, qty: l.qty, unitPrice: l.unitPrice.toString() })),
  )
  // Keep each line's product and description: the offer only changes quantities and prices.
  const prior = new Map(before.lines.map((l) => [l.lineNo, l]))
  await raceHook?.('accept:after-read', quoteId)

  await storefrontDb.$transaction(async (tx) => {
    // Guard first, in the same transaction as the line rewrite: the quote must still be as read (status, version,
    // no order). An approval, a conversion claim or another acceptance in between bumps the version, so this misses.
    const guarded = await tx.b2BQuote.updateMany({
      where: { id: quoteId, tenantId, status: { in: COUNTER_ELIGIBLE }, version: before.version, convertedOrderId: null },
      data: { status: QuoteStatus.OPEN, version: { increment: 1 } },
    })
    if (guarded.count !== 1) {
      const now = await tx.b2BQuote.findFirst({ where: { id: quoteId, tenantId }, select: { status: true, convertedOrderId: true } })
      if (now?.convertedOrderId || now?.status === QuoteStatus.SUBMITTED) throw new ApiError(409, QUOTE_LOCKED_FOR_ORDER)
      if (now?.status === QuoteStatus.APPROVED) throw new ApiError(409, APPROVED_MEANWHILE)
      throw new ApiError(409, QUOTE_CHANGED)
    }
    const taken = await tx.quoteCounterOffer.updateMany({
      where: { id: counterOfferId, quoteId, status: OFFER_OPEN },
      data: { status: OFFER_ACCEPTED, acceptedByUserId: actor.userId, acceptedAt: new Date() },
    })
    if (taken.count !== 1) throw new ApiError(409, 'This counter-offer was already answered. Reload and try again.')
    // The other open offers were made against the terms this one just replaced: none of them can be accepted now.
    await supersedeOpenOffers(tx, quoteId, counterOfferId)
    await tx.quoteLine.deleteMany({ where: { quoteId } })
    await tx.quoteLine.createMany({
      data: lines.map((l) => ({
        quoteId,
        lineNo: l.lineNo,
        skuCode: prior.get(l.lineNo)?.skuCode ?? null,
        description: prior.get(l.lineNo)?.description ?? `Line ${l.lineNo}`,
        qty: l.qty,
        unitPrice: l.unitPrice,
      })),
    })
  })
  return getQuote(tenantId, quoteId, opts)
}

// ---- Phase 5: buyers edit and withdraw their own quotes ----

/** The buyer acting, from the authenticated portal session (never the request body). */
export type BuyerQuoteActor = { userId: string; buyerCustomerId: string }

/** Statuses a buyer may still edit or withdraw. APPROVED, SUBMITTED, EXPIRED and WITHDRAWN never change. */
const BUYER_EDITABLE: QuoteStatus[] = [QuoteStatus.OPEN, QuoteStatus.PENDING_APPROVAL, QuoteStatus.REJECTED]
const EDIT_FIELDS = ['expectedVersion', 'notes', 'lines']
const WITHDRAW_FIELDS = ['expectedVersion', 'withdrawReason']
const MAX_QUOTE_LINES = 200
const MAX_QUOTE_NOTES = 2000
const MAX_WITHDRAW_REASON = 500
const NOT_YOUR_QUOTE = 'Only the buyer who created this quote in the portal can change it.'

/** Only the listed fields may be sent: anything else (status, customerRef, version, creator…) is refused, not ignored. */
function assertOnlyFields(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Request body must be a JSON object')
  const extra = Object.keys(body).filter((k) => !allowed.includes(k))
  if (extra.length > 0) {
    throw new ApiError(400, `These fields can't be changed here: ${extra.join(', ')}. Allowed: ${allowed.join(', ')}.`)
  }
  return body as Record<string, unknown>
}

/** The version the buyer was looking at. Required: an edit or withdrawal must never land on terms they didn't see. */
function requireExpectedVersion(raw: unknown): number {
  if (raw === undefined || raw === null) throw new ApiError(400, 'expectedVersion is required')
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    throw new ApiError(400, 'expectedVersion must be a whole number of 0 or more')
  }
  return raw
}

/** Optional text: absent keeps the current value; null or blank clears it; otherwise trimmed and length-checked. */
function optionalText(raw: unknown, field: string, max: number): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (typeof raw !== 'string') throw new ApiError(400, `${field} must be text`)
  const t = raw.trim()
  if (!t) return null
  if (t.length > max) throw new ApiError(400, `${field} can be at most ${max} characters`)
  return t
}

/**
 * The quote, if this buyer may change it. Not visible to them (another tenant or customer): 404, as everywhere else.
 * Visible but not theirs to change (raised by staff or a sales rep, by another login of the customer, or a legacy
 * quote with no recorded creator): 403. Ownership comes only from the stored creator and the session.
 */
async function loadBuyerOwnedQuote(tenantId: string, id: string, actor: BuyerQuoteActor) {
  const q = await getQuote(tenantId, id, { buyerCustomerId: actor.buyerCustomerId })
  if (!buyerCreatedQuote(q, actor.userId)) throw new ApiError(403, NOT_YOUR_QUOTE)
  return q
}

/** This buyer raised the quote in the portal (a legacy quote with no recorded creator never matches). */
function buyerCreatedQuote(q: { createdVia: QuoteOrigin | null; createdByUserId: string | null }, userId: string) {
  return q.createdVia === QuoteOrigin.BUYER_PORTAL && !!q.createdByUserId && q.createdByUserId === userId
}

/**
 * Whether this buyer may edit / withdraw the quote right now, by the same rules the PATCH and withdraw endpoints
 * enforce (ownership, portal.quotes, an editable status, no order). For showing or hiding the buttons only: the
 * endpoints check everything again. Lets buyer responses say "yours to change" without revealing creator ids.
 */
export function buyerQuoteRights(
  q: { status: QuoteStatus; convertedOrderId: string | null; createdVia: QuoteOrigin | null; createdByUserId: string | null },
  userId: string,
  hasPortalQuotes: boolean,
): { canEdit: boolean; canWithdraw: boolean } {
  const allowed = hasPortalQuotes && buyerCreatedQuote(q, userId) && BUYER_EDITABLE.includes(q.status) && !q.convertedOrderId
  return { canEdit: allowed, canWithdraw: allowed }
}

/** Wrong status: 400, as the other quote actions answer; a different version than the buyer saw: 409. */
function assertBuyerCanChange(q: { status: QuoteStatus; convertedOrderId: string | null; version: number }, action: 'edit' | 'withdraw', expectedVersion: number) {
  if (q.status === QuoteStatus.WITHDRAWN) throw new ApiError(400, `This quote was withdrawn, so it can't be ${action === 'edit' ? 'edited' : 'withdrawn again'}`)
  if (!BUYER_EDITABLE.includes(q.status) || q.convertedOrderId) {
    throw new ApiError(400, `A ${q.status.toLowerCase()} quote can't be ${action === 'edit' ? 'edited' : 'withdrawn'}`)
  }
  if (q.version !== expectedVersion) throw new ApiError(409, QUOTE_CHANGED)
}

/** Why a guarded buyer write missed, read inside its transaction: always 409, with the most useful message. */
async function buyerWriteMissed(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<never> {
  const now = await tx.b2BQuote.findFirst({ where: { id, tenantId }, select: { status: true, convertedOrderId: true } })
  if (now?.convertedOrderId || now?.status === QuoteStatus.SUBMITTED) throw new ApiError(409, QUOTE_LOCKED_FOR_ORDER)
  if (now?.status === QuoteStatus.APPROVED) throw new ApiError(409, APPROVED_MEANWHILE)
  if (now?.status === QuoteStatus.WITHDRAWN) throw new ApiError(409, 'This quote was withdrawn at the same time. Reload it.')
  throw new ApiError(409, QUOTE_CHANGED)
}

type BuyerLine = { lineNo: number; skuCode: string; description: string; qty: number; unitPrice: Prisma.Decimal }

/**
 * A buyer's replacement lines, in the shape quote creation takes ({ lineNo, skuCode, description?, qty, unitPrice }).
 * The same rules as creation (an active product of this tenant on every line, quantity of 1 or more, price of 0 or
 * more, unique line numbers), plus the limits counter-offers already apply: whole line numbers, at most
 * MAX_LINE_QUANTITY per line, plain prices with at most 4 decimals, and a cap on the number of lines.
 */
async function validateBuyerQuoteLines(tenantId: string, raw: unknown): Promise<BuyerLine[]> {
  if (!Array.isArray(raw) || raw.length === 0) throw new ApiError(400, 'A quote needs at least one line')
  if (raw.length > MAX_QUOTE_LINES) throw new ApiError(400, `A quote can have at most ${MAX_QUOTE_LINES} lines`)
  const seen = new Set<number>()
  const lines: BuyerLine[] = []
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError(400, `Line ${i + 1}: must be an object`)
    const { lineNo, skuCode, description, qty, unitPrice } = item as Record<string, unknown>
    if (typeof lineNo !== 'number' || !Number.isInteger(lineNo) || lineNo < 1) {
      throw new ApiError(400, `Line ${i + 1}: lineNo must be a whole number of 1 or more`)
    }
    if (seen.has(lineNo)) throw new ApiError(400, 'Duplicate line numbers')
    seen.add(lineNo)
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > orders.MAX_LINE_QUANTITY) {
      throw new ApiError(400, `Line ${lineNo}: quantity must be a whole number from 1 to ${orders.MAX_LINE_QUANTITY}`)
    }
    const price = parseUnitPrice(unitPrice, lineNo, { allowZero: true })
    if (skuCode !== undefined && skuCode !== null && typeof skuCode !== 'string') throw new ApiError(400, `Line ${lineNo}: skuCode must be text`)
    const sku = await quoteLineSku(tenantId, lineNo, skuCode as string | null | undefined)
    const desc = optionalText(description, `Line ${lineNo}: description`, 500)
    lines.push({ lineNo, skuCode: sku.code, description: desc || sku.name, qty, unitPrice: price })
  }
  return lines.sort((a, b) => a.lineNo - b.lineNo)
}

/**
 * A buyer edits their own quote: notes and/or the full set of lines. One storefront transaction, guarded on tenant,
 * customer, creator, the status read and the version the buyer saw: the quote goes back to OPEN at version + 1 (so it
 * needs approval again), lines are replaced together, and open counter-offers (made against the old lines) are
 * marked SUPERSEDED. A stale version, or an approval, conversion, acceptance or withdrawal in between, gets 409.
 */
export async function editQuoteAsBuyer(tenantId: string, id: string, rawBody: unknown, actor: BuyerQuoteActor) {
  const body = assertOnlyFields(rawBody, EDIT_FIELDS)
  const expectedVersion = requireExpectedVersion(body.expectedVersion)
  if (body.notes === undefined && body.lines === undefined) throw new ApiError(400, 'Nothing to change: send notes and/or lines')
  const q = await loadBuyerOwnedQuote(tenantId, id, actor)
  assertBuyerCanChange(q, 'edit', expectedVersion)
  const notes = optionalText(body.notes, 'notes', MAX_QUOTE_NOTES)
  await crm.assertCustomerCanTransact(tenantId, q.customerRef)
  await resolveQuoteCustomerId(tenantId, q.customerRef)
  const lines = body.lines === undefined ? null : await validateBuyerQuoteLines(tenantId, body.lines)
  await raceHook?.('edit:after-read', id)

  await storefrontDb.$transaction(async (tx) => {
    const guarded = await tx.b2BQuote.updateMany({
      where: {
        id,
        tenantId,
        customerRef: actor.buyerCustomerId,
        createdVia: QuoteOrigin.BUYER_PORTAL,
        createdByUserId: actor.userId,
        status: q.status,
        version: expectedVersion,
        convertedOrderId: null,
      },
      data: { status: QuoteStatus.OPEN, version: { increment: 1 }, ...(notes !== undefined ? { notes } : {}) },
    })
    if (guarded.count !== 1) await buyerWriteMissed(tx, tenantId, id)
    if (lines) {
      await tx.quoteLine.deleteMany({ where: { quoteId: id } })
      await tx.quoteLine.createMany({ data: lines.map((l) => ({ quoteId: id, ...l })) })
      // Offers name the old line numbers and quantities: none of them may be applied to the new lines.
      await supersedeOpenOffers(tx, id)
    }
  })
  return getQuote(tenantId, id, { buyerCustomerId: actor.buyerCustomerId })
}

/**
 * A buyer withdraws their own quote (soft: nothing is deleted). Same ownership and version guard as editing; the
 * quote becomes WITHDRAWN at version + 1 with the server's time and an optional reason. Lines and counter-offers are
 * kept as history; open offers are marked SUPERSEDED. A withdrawn quote is never approved, converted, edited,
 * counter-offered or withdrawn again (each of those checks the status, and the version moved).
 */
export async function withdrawQuoteAsBuyer(tenantId: string, id: string, rawBody: unknown, actor: BuyerQuoteActor) {
  const body = assertOnlyFields(rawBody, WITHDRAW_FIELDS)
  const expectedVersion = requireExpectedVersion(body.expectedVersion)
  const reason = optionalText(body.withdrawReason, 'withdrawReason', MAX_WITHDRAW_REASON) ?? null
  const q = await loadBuyerOwnedQuote(tenantId, id, actor)
  assertBuyerCanChange(q, 'withdraw', expectedVersion)
  await raceHook?.('withdraw:after-read', id)

  await storefrontDb.$transaction(async (tx) => {
    const guarded = await tx.b2BQuote.updateMany({
      where: {
        id,
        tenantId,
        customerRef: actor.buyerCustomerId,
        createdVia: QuoteOrigin.BUYER_PORTAL,
        createdByUserId: actor.userId,
        status: q.status,
        version: expectedVersion,
        convertedOrderId: null,
      },
      data: { status: QuoteStatus.WITHDRAWN, withdrawnAt: new Date(), withdrawReason: reason, version: { increment: 1 } },
    })
    if (guarded.count !== 1) await buyerWriteMissed(tx, tenantId, id)
    await supersedeOpenOffers(tx, id)
  })
  return getQuote(tenantId, id, { buyerCustomerId: actor.buyerCustomerId })
}
