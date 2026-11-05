/**
 * Staff quote actions (Ticket #3, Phase 7): which buttons the admin quotes page shows, the approve / reject request
 * bodies, and how a stale decision reads. Mirrors the server's rules so staff are never offered an action the
 * server would refuse; the server still checks permission, tenant, status and version on every request.
 */
import axios from 'axios'
import { hasClientPermission, type Viewer } from './requisitions'

export type AdminQuote = {
  id: string
  status: string
  /** The version the page loaded; sent back with a decision so a quote changed since then gets 409. */
  version: number
  convertedOrderId?: string | null
}

export type AdminOffer = {
  status: string
  /** Display label from older clients and the server ("BUYER" / "ADMIN"). */
  offeredBy: string
  /** Server-set side on offers made since Phase 4; null on legacy offers. */
  side?: string | null
}

/** Filter tabs on the quotes page. Withdrawn and expired quotes stay in history and can be listed. */
export const QUOTE_FILTERS = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'OPEN', 'SUBMITTED', 'EXPIRED', 'WITHDRAWN', 'ALL'] as const

/** Counter-offers can be made and accepted on these only (the server's COUNTER_ELIGIBLE). */
const NEGOTIABLE = ['OPEN', 'PENDING_APPROVAL', 'REJECTED']

export const STALE_QUOTE_MESSAGE = 'This quote has changed since you opened it. Reload the latest version before continuing.'

export type AdminQuoteActions = {
  approve: boolean
  reject: boolean
  /** Send a staff counter-offer. */
  counter: boolean
  createOrder: boolean
  /** Why this quote's terms can't be decided or negotiated any more, when they can't. */
  lockedReason: string | null
  /** Shown when the quote could be acted on but the viewer lacks the permission. */
  readOnlyReason: string | null
}

/**
 * What the signed-in staff member can do with this quote. Needs both the permission the server checks
 * (quotes.write for decisions and counter-offers, orders.write to create the order) and a status that allows it.
 */
export function adminQuoteActions(q: Pick<AdminQuote, 'status' | 'convertedOrderId'>, viewer: Viewer | undefined): AdminQuoteActions {
  const write = hasClientPermission(viewer, 'quotes.write')
  const pending = q.status === 'PENDING_APPROVAL' && !q.convertedOrderId
  const negotiable = NEGOTIABLE.includes(q.status) && !q.convertedOrderId
  const lockedReason = adminLockedReason(q.status, q.convertedOrderId)
  return {
    approve: write && pending,
    reject: write && pending,
    counter: write && negotiable,
    createOrder: hasClientPermission(viewer, 'orders.write') && q.status === 'APPROVED' && !q.convertedOrderId,
    lockedReason,
    readOnlyReason: !write && !lockedReason ? 'You can view this quote. Approving, rejecting and counter-offers need quote write access.' : null,
  }
}

export function adminLockedReason(status: string, convertedOrderId?: string | null): string | null {
  if (convertedOrderId || status === 'SUBMITTED') return 'An order was created from this quote, so its terms can no longer be changed.'
  if (status === 'APPROVED') return 'This quote is approved, so its terms are final. Counter-offers are closed; a new quote is needed to negotiate different terms.'
  if (status === 'EXPIRED') return 'This quote has expired and can no longer be changed.'
  if (status === 'WITHDRAWN') return 'The buyer withdrew this quote. It is kept for history and can no longer be approved, rejected or countered.'
  return null
}

/**
 * Staff may accept only an open offer from the buyer's side, on a quote that can still be negotiated. Legacy offers
 * (no recorded side) are accepted by the server only when labelled BUYER, so only those get the button.
 */
export function canStaffAcceptOffer(
  q: Pick<AdminQuote, 'status' | 'convertedOrderId'>,
  offer: AdminOffer,
  viewer: Viewer | undefined,
): boolean {
  if (!adminQuoteActions(q, viewer).counter) return false
  if (offer.status !== 'OPEN') return false
  return offer.side ? offer.side === 'BUYER' : offer.offeredBy === 'BUYER'
}

/** Who made the offer, for display: the server-set side when there is one, else the legacy label. */
export function offerSideLabel(offer: AdminOffer): string {
  const buyer = offer.side ? offer.side === 'BUYER' : offer.offeredBy === 'BUYER'
  return buyer ? 'Buyer' : 'Staff'
}

/** A short explanation next to an offer that can't be accepted any more, or null. */
export function offerNote(offer: AdminOffer): string | null {
  if (offer.status === 'SUPERSEDED') return 'Replaced: another offer was accepted or the quote was approved. It can no longer be accepted.'
  if (offer.status === 'OPEN' && !offer.side && offer.offeredBy !== 'BUYER') {
    return 'Made before offers recorded who sent them, so it cannot be accepted safely.'
  }
  return null
}

/**
 * The approve body: the version of the quote as the page shows it, never one fetched just before sending, so an
 * approval of a quote that changed since it was reviewed is refused (409) instead of approving unseen terms.
 */
export function approveBody(q: Pick<AdminQuote, 'version'>): { expectedVersion: number } {
  return { expectedVersion: q.version }
}

export function rejectBody(q: Pick<AdminQuote, 'version'>, reason: string): { reason: string; expectedVersion: number } {
  return { reason, expectedVersion: q.version }
}

export type AdminActionError = { conflict: boolean; message: string }

/** How a failed staff action reads. A 409 asks for a reload; nothing is ever retried automatically. */
export function adminActionError(e: unknown): AdminActionError {
  const status = axios.isAxiosError(e) ? e.response?.status : undefined
  if (status === 409) return { conflict: true, message: STALE_QUOTE_MESSAGE }
  const raw = axios.isAxiosError(e) ? (e.response?.data as { message?: unknown } | undefined)?.message : undefined
  if (typeof raw === 'string' && raw.trim()) return { conflict: false, message: raw }
  if (Array.isArray(raw)) return { conflict: false, message: raw.join(', ') }
  return { conflict: false, message: e instanceof Error ? e.message : 'The request failed. Please try again.' }
}
