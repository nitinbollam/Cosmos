/**
 * Buyer quote actions (Ticket #3, Phase 6): which buttons the portal shows on a quote, the edit / withdraw request
 * bodies, and how their errors read. The server decides who may change a quote and sends that as canEdit /
 * canWithdraw; nothing here grants anything: every endpoint checks ownership, status and version again.
 */
import axios from 'axios'
import { quoteLinesProblem, type QuoteLineDraft } from './quote-lines'

/** The quote as the buyer API returns it (no creator or approver ids are ever sent to buyers). */
export type BuyerQuote = {
  id: string
  status: string
  version: number
  notes?: string | null
  convertedOrderId?: string | null
  withdrawnAt?: string | null
  withdrawReason?: string | null
  createdVia?: string | null
  /** Worked out by the server from the session; absent on older responses, which means "no". */
  canEdit?: boolean
  canWithdraw?: boolean
  lines: Array<{ lineNo: number; skuCode?: string | null; description: string; qty: number; unitPrice: string | number }>
}

export type BuyerOffer = { status: string; offeredBy: string }

/** The statuses a buyer can still change; the server's list, used only to hide stale buttons sooner. */
const CHANGEABLE = ['OPEN', 'PENDING_APPROVAL', 'REJECTED']
/** Counter-offers can be made and accepted on these only (approved quotes are final). */
const NEGOTIABLE = ['OPEN', 'PENDING_APPROVAL', 'REJECTED']

/** Matches the server's limits, so most mistakes are caught before sending. */
export const MAX_LINE_QUANTITY = 1_000_000
export const MAX_QUOTE_LINES = 200
export const MAX_NOTES = 2000
export const MAX_WITHDRAW_REASON = 500
const PRICE = /^\d+(\.\d{1,4})?$/

export type QuoteActions = {
  edit: boolean
  withdraw: boolean
  /** Propose a counter-offer. */
  counter: boolean
  /** Ask for approval / place the order: unchanged from before. */
  requestApproval: boolean
  placeOrder: boolean
  /** Shown next to Edit: what saving does to the quote's approval. */
  editWarning: string | null
  /** Why the quote can't be changed any more, when it can't. */
  lockedReason: string | null
}

/**
 * What the buyer can do with this quote. Edit and withdraw need the server's flag AND a changeable status (so a quote
 * that moved on since it was loaded loses its buttons at once); a status alone never shows them.
 */
export function quoteActions(q: Pick<BuyerQuote, 'status' | 'convertedOrderId' | 'canEdit' | 'canWithdraw'>): QuoteActions {
  const changeable = CHANGEABLE.includes(q.status) && !q.convertedOrderId
  const negotiable = NEGOTIABLE.includes(q.status) && !q.convertedOrderId
  return {
    edit: q.canEdit === true && changeable,
    withdraw: q.canWithdraw === true && changeable,
    counter: negotiable,
    requestApproval: (q.status === 'OPEN' || q.status === 'REJECTED') && !q.convertedOrderId,
    placeOrder: q.status === 'APPROVED' && !q.convertedOrderId,
    editWarning: editWarning(q.status),
    lockedReason: lockedReason(q.status, q.convertedOrderId),
  }
}

export function editWarning(status: string): string | null {
  if (status === 'PENDING_APPROVAL') {
    return 'This quote is waiting for approval. Saving changes moves it back to Open, and you will need to submit it for approval again.'
  }
  if (status === 'REJECTED') return 'Saving changes moves this quote back to Open, so you can submit it for approval again.'
  return null
}

export function lockedReason(status: string, convertedOrderId?: string | null): string | null {
  if (convertedOrderId || status === 'SUBMITTED') return 'An order was placed from this quote, so it can no longer be changed.'
  if (status === 'APPROVED') return 'This quote is approved, so its terms are final. Place the order, or start a new quote to negotiate different terms.'
  if (status === 'EXPIRED') return 'This quote has expired and can no longer be changed.'
  if (status === 'WITHDRAWN') return 'You withdrew this quote. It is kept for your records and can no longer be changed.'
  return null
}

/** Accept is offered only on an open offer from the other side (staff), on a quote that can still be negotiated. */
export function canAcceptOffer(q: Pick<BuyerQuote, 'status' | 'convertedOrderId'>, offer: BuyerOffer): boolean {
  return offer.status === 'OPEN' && offer.offeredBy === 'ADMIN' && NEGOTIABLE.includes(q.status) && !q.convertedOrderId
}

/** The edit form's starting point: the quote as last loaded. */
export function editDraft(q: BuyerQuote): { notes: string; lines: QuoteLineDraft[] } {
  return {
    notes: q.notes ?? '',
    lines: [...q.lines]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => ({
        lineNo: l.lineNo,
        skuCode: l.skuCode ?? '',
        description: l.description,
        qty: String(l.qty),
        unitPrice: String(Number(l.unitPrice)),
      })),
  }
}

export type EditLine = { lineNo: number; skuCode: string; description?: string; qty: number; unitPrice: number | string }
export type EditBody = { expectedVersion: number; notes?: string | null; lines?: EditLine[] }

/** The first problem with an edit, or null. The same rules the server applies (it checks them all again). */
export function editProblem(draft: { notes: string; lines: QuoteLineDraft[] }): string | null {
  if (draft.notes.trim().length > MAX_NOTES) return `Notes can be at most ${MAX_NOTES} characters`
  if (draft.lines.length > MAX_QUOTE_LINES) return `A quote can have at most ${MAX_QUOTE_LINES} lines`
  const base = quoteLinesProblem(draft.lines)
  if (base) return base
  const seen = new Set<number>()
  for (const l of draft.lines) {
    if (seen.has(l.lineNo)) return 'Duplicate line numbers'
    seen.add(l.lineNo)
    if (Number(l.qty) > MAX_LINE_QUANTITY) return `Line ${l.lineNo}: quantity can be at most ${MAX_LINE_QUANTITY.toLocaleString('en-US')}`
    if (!PRICE.test(l.unitPrice.trim())) return `Line ${l.lineNo}: enter a unit price such as 19 or 19.50 (at most 4 decimal places)`
  }
  return null
}

const sameLines = (a: EditLine[], b: EditLine[]) => JSON.stringify(a) === JSON.stringify(b)

function toEditLines(lines: QuoteLineDraft[]): EditLine[] {
  return lines.map((l) => ({
    lineNo: l.lineNo,
    skuCode: l.skuCode.trim(),
    description: l.description.trim() || undefined,
    qty: Number(l.qty),
    // Sent as the decimal text the buyer typed, so 19.10 is never turned into a float on the way.
    unitPrice: l.unitPrice.trim(),
  }))
}

/**
 * The PATCH /quotes/:id body for this draft, or the problem that stops it. expectedVersion is the version of the
 * quote the buyer is looking at (never updatedAt). Only what changed is sent; nothing that changed is an error.
 */
export function buildEditBody(
  q: BuyerQuote,
  draft: { notes: string; lines: QuoteLineDraft[] },
): { ok: true; body: EditBody } | { ok: false; error: string } {
  const problem = editProblem(draft)
  if (problem) return { ok: false, error: problem }
  const body: EditBody = { expectedVersion: q.version }
  const notes = draft.notes.trim()
  if (notes !== (q.notes ?? '').trim()) body.notes = notes || null
  const lines = toEditLines(draft.lines)
  if (!sameLines(lines, toEditLines(editDraft(q).lines))) body.lines = lines
  if (body.notes === undefined && body.lines === undefined) return { ok: false, error: 'There are no changes to save' }
  return { ok: true, body }
}

export type WithdrawBody = { expectedVersion: number; withdrawReason?: string }

/** The POST /quotes/:id/withdraw body; the reason is optional and only sent when given. */
export function buildWithdrawBody(q: Pick<BuyerQuote, 'version'>, reason: string): { ok: true; body: WithdrawBody } | { ok: false; error: string } {
  const r = reason.trim()
  if (r.length > MAX_WITHDRAW_REASON) return { ok: false, error: `The reason can be at most ${MAX_WITHDRAW_REASON} characters` }
  return { ok: true, body: r ? { expectedVersion: q.version, withdrawReason: r } : { expectedVersion: q.version } }
}

export type ActionError = { kind: 'conflict' | 'forbidden' | 'not-found' | 'unavailable' | 'invalid'; message: string }

/**
 * How a failed edit or withdrawal reads. A 409 means the quote changed since it was opened: the buyer is offered a
 * reload, and their unsaved edits are kept until they choose to reload (nothing is overwritten automatically).
 */
export function actionError(e: unknown): ActionError {
  const status = axios.isAxiosError(e) ? e.response?.status : undefined
  const raw = axios.isAxiosError(e) ? (e.response?.data as { message?: unknown } | undefined)?.message : undefined
  const server = typeof raw === 'string' && raw.trim() ? raw : null
  if (status === 409) {
    // The server's reason, minus its own "reload and try again" ending, so the guidance is given once.
    const reason = (server ?? '').replace(/[\s;,]*\breload\b[^.]*\.?\s*$/i, '').trim() || 'This quote was changed since you opened it'
    return {
      kind: 'conflict',
      message: `${/[.!?]$/.test(reason) ? reason : `${reason}.`} Reload to see the latest version; your unsaved changes stay here until you do.`,
    }
  }
  if (status === 403) return { kind: 'forbidden', message: server ?? 'You can only change quotes you created in the portal.' }
  if (status === 404) return { kind: 'not-found', message: 'This quote is no longer available.' }
  if (status === 503) return { kind: 'unavailable', message: server ?? 'The service is temporarily unavailable. Please try again in a few minutes.' }
  if (status === 400) return { kind: 'invalid', message: server ?? 'Please check the quote and try again.' }
  return { kind: 'unavailable', message: server ?? (e instanceof Error ? e.message : 'The request failed. Please try again.') }
}

/**
 * Runs one request at a time: a second call while the first is still in flight (a double click, Enter pressed
 * twice) is ignored and returns undefined, so no duplicate request is ever sent.
 */
export function singleFlight() {
  let running = false
  return {
    get busy() {
      return running
    },
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (running) return undefined
      running = true
      try {
        return await fn()
      } finally {
        running = false
      }
    },
  }
}
