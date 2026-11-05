import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AxiosError, AxiosHeaders } from 'axios'
import {
  QUOTE_FILTERS,
  STALE_QUOTE_MESSAGE,
  adminActionError,
  adminQuoteActions,
  approveBody,
  canStaffAcceptOffer,
  offerNote,
  offerSideLabel,
  rejectBody,
} from './admin-quote'

const manager = { userId: 'u-m', role: 'MANAGER', permissions: ['quotes.*', 'orders.*'] }
const quoteWriter = { userId: 'u-w', role: 'STAFF', permissions: ['quotes.read', 'quotes.write'] }
const reader = { userId: 'u-r', role: 'VIEWER', permissions: ['quotes.read'] }
const admin = { userId: 'u-a', role: 'TENANT_ADMIN', permissions: [] }

const q = (status: string, over: { convertedOrderId?: string | null; version?: number } = {}) => ({
  id: 'q1',
  status,
  version: over.version ?? 4,
  convertedOrderId: over.convertedOrderId ?? null,
})

function httpError(status: number, message?: string) {
  const headers = new AxiosHeaders()
  return new AxiosError('Request failed', 'ERR', { headers }, null, {
    status,
    statusText: '',
    headers: {},
    config: { headers },
    data: message === undefined ? {} : { message },
  })
}

test('1. withdrawn quotes can be listed: the filters include WITHDRAWN and EXPIRED, and ALL', () => {
  for (const s of ['WITHDRAWN', 'EXPIRED', 'ALL', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'OPEN', 'SUBMITTED']) {
    assert.ok((QUOTE_FILTERS as readonly string[]).includes(s), s)
  }
})

test('2-4. a withdrawn quote offers no approve, reject, counter-offer or order action and says why', () => {
  for (const viewer of [manager, admin]) {
    const a = adminQuoteActions(q('WITHDRAWN'), viewer)
    assert.deepEqual([a.approve, a.reject, a.counter, a.createOrder], [false, false, false, false])
    assert.match(a.lockedReason ?? '', /withdrew this quote.*kept for history/i)
    assert.equal(a.readOnlyReason, null)
  }
})

test('5-8. no counter-offer on approved, submitted, expired, withdrawn or converted quotes', () => {
  for (const status of ['APPROVED', 'SUBMITTED', 'EXPIRED', 'WITHDRAWN']) {
    const a = adminQuoteActions(q(status), manager)
    assert.equal(a.counter, false, status)
    assert.ok(a.lockedReason, status)
    // ... and no acceptance of any offer on them, not even an open buyer offer.
    assert.equal(canStaffAcceptOffer(q(status), { status: 'OPEN', offeredBy: 'BUYER', side: 'BUYER' }, manager), false, status)
  }
  assert.equal(adminQuoteActions(q('OPEN', { convertedOrderId: 'o1' }), manager).counter, false)
  assert.match(adminQuoteActions(q('APPROVED'), manager).lockedReason ?? '', /approved.*final/i)
  // Negotiable statuses keep the counter-offer form for quote writers.
  for (const status of ['OPEN', 'PENDING_APPROVAL', 'REJECTED']) assert.equal(adminQuoteActions(q(status), manager).counter, true, status)
})

test('9. a superseded offer cannot be accepted and is explained; only open buyer offers can', () => {
  const pending = q('PENDING_APPROVAL')
  const superseded = { status: 'SUPERSEDED', offeredBy: 'BUYER', side: 'BUYER' }
  assert.equal(canStaffAcceptOffer(pending, superseded, manager), false)
  assert.match(offerNote(superseded) ?? '', /replaced.*can no longer be accepted/i)
  assert.equal(canStaffAcceptOffer(pending, { status: 'ACCEPTED', offeredBy: 'BUYER', side: 'BUYER' }, manager), false)
  assert.equal(canStaffAcceptOffer(pending, { status: 'OPEN', offeredBy: 'BUYER', side: 'BUYER' }, manager), true)
  // Staff never accept their own side's offer.
  assert.equal(canStaffAcceptOffer(pending, { status: 'OPEN', offeredBy: 'ADMIN', side: 'STAFF' }, manager), false)
  // The server-set side wins over a forged legacy label.
  assert.equal(canStaffAcceptOffer(pending, { status: 'OPEN', offeredBy: 'BUYER', side: 'STAFF' }, manager), false)
  assert.equal(offerSideLabel({ status: 'OPEN', offeredBy: 'BUYER', side: 'STAFF' }), 'Staff')
})

test('legacy offers (no recorded side): staff may accept only one labelled BUYER, as the server allows', () => {
  const pending = q('PENDING_APPROVAL')
  assert.equal(canStaffAcceptOffer(pending, { status: 'OPEN', offeredBy: 'BUYER', side: null }, manager), true)
  const legacyAdmin = { status: 'OPEN', offeredBy: 'ADMIN', side: null }
  assert.equal(canStaffAcceptOffer(pending, legacyAdmin, manager), false)
  assert.match(offerNote(legacyAdmin) ?? '', /cannot be accepted safely/)
  assert.equal(offerSideLabel(legacyAdmin), 'Staff')
  assert.equal(offerNote({ status: 'OPEN', offeredBy: 'BUYER', side: null }), null)
})

test('10-11. approve and reject send the displayed version as expectedVersion, and keep the reason field', () => {
  const shown = q('PENDING_APPROVAL', { version: 7 })
  assert.deepEqual(approveBody(shown), { expectedVersion: 7 })
  assert.deepEqual(rejectBody(shown, 'Prices too low'), { reason: 'Prices too low', expectedVersion: 7 })
  // Version 0 (a quote never changed) is still sent.
  assert.deepEqual(approveBody({ version: 0 }), { expectedVersion: 0 })
})

test('12-15. a 409 reads as a stale view with reload guidance; other errors keep the server message', () => {
  for (const server of [undefined, 'This quote was changed at the same time by someone else. Reload it and try again.']) {
    const e = adminActionError(httpError(409, server))
    assert.equal(e.conflict, true)
    assert.equal(e.message, STALE_QUOTE_MESSAGE)
  }
  assert.equal(STALE_QUOTE_MESSAGE, 'This quote has changed since you opened it. Reload the latest version before continuing.')
  assert.deepEqual(adminActionError(httpError(400, 'Only pending quotes can be approved')), {
    conflict: false,
    message: 'Only pending quotes can be approved',
  })
  assert.deepEqual(adminActionError(httpError(403, 'Forbidden')), { conflict: false, message: 'Forbidden' })
  assert.equal(adminActionError(new Error('Network Error')).message, 'Network Error')
  assert.equal(adminActionError(httpError(500)).conflict, false)
})

test('16. the existing workflow is unchanged for quote writers: approve/reject pending, order from approved', () => {
  const p = adminQuoteActions(q('PENDING_APPROVAL'), manager)
  assert.deepEqual([p.approve, p.reject, p.counter, p.createOrder], [true, true, true, false])
  const ap = adminQuoteActions(q('APPROVED'), manager)
  assert.deepEqual([ap.approve, ap.reject, ap.counter, ap.createOrder], [false, false, false, true])
  assert.equal(adminQuoteActions(q('APPROVED', { convertedOrderId: 'o1' }), manager).createOrder, false)
  for (const status of ['OPEN', 'REJECTED']) {
    const a = adminQuoteActions(q(status), manager)
    assert.deepEqual([a.approve, a.reject], [false, false], status)
  }
})

test('17. actions follow permissions, not status alone', () => {
  // Read-only staff: nothing to act on, and told why.
  for (const status of ['PENDING_APPROVAL', 'OPEN', 'REJECTED', 'APPROVED']) {
    const a = adminQuoteActions(q(status), reader)
    assert.deepEqual([a.approve, a.reject, a.counter, a.createOrder], [false, false, false, false], status)
    assert.equal(canStaffAcceptOffer(q(status), { status: 'OPEN', offeredBy: 'BUYER', side: 'BUYER' }, reader), false)
  }
  assert.match(adminQuoteActions(q('PENDING_APPROVAL'), reader).readOnlyReason ?? '', /need quote write access/)
  // quotes.write without orders.write: decisions yes, creating the order no (the server needs orders.write).
  const w = adminQuoteActions(q('PENDING_APPROVAL'), quoteWriter)
  assert.deepEqual([w.approve, w.reject, w.counter], [true, true, true])
  assert.equal(adminQuoteActions(q('APPROVED'), quoteWriter).createOrder, false)
  // Tenant admins hold every permission; an unknown viewer (still loading) gets nothing.
  assert.equal(adminQuoteActions(q('PENDING_APPROVAL'), admin).approve, true)
  assert.equal(adminQuoteActions(q('PENDING_APPROVAL'), undefined).approve, false)
  assert.equal(adminQuoteActions(q('PENDING_APPROVAL'), { role: 'STAFF', permissions: ['quotes.*'] }).approve, true)
})
