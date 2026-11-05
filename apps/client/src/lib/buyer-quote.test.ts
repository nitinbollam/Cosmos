import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AxiosError, AxiosHeaders } from 'axios'
import {
  actionError,
  buildEditBody,
  buildWithdrawBody,
  canAcceptOffer,
  editDraft,
  editProblem,
  quoteActions,
  singleFlight,
  type BuyerQuote,
} from './buyer-quote'

const quote = (over: Partial<BuyerQuote> = {}): BuyerQuote => ({
  id: 'q1',
  status: 'OPEN',
  version: 3,
  notes: 'first draft',
  convertedOrderId: null,
  createdVia: 'BUYER_PORTAL',
  canEdit: true,
  canWithdraw: true,
  lines: [
    { lineNo: 1, skuCode: 'PEN', description: 'Pens', qty: 10, unitPrice: '20' },
    { lineNo: 2, skuCode: 'PAD', description: 'Pads', qty: 5, unitPrice: '8.5' },
  ],
  ...over,
})

function httpError(status: number, message?: string) {
  const err = new AxiosError('failed')
  err.response = { status, statusText: '', data: message ? { message } : {}, headers: {}, config: { headers: new AxiosHeaders() } }
  return err
}

// ---- 1-10: which actions show ----

test('1-3. the buyer’s own OPEN, PENDING_APPROVAL and REJECTED quotes show Edit and Withdraw', () => {
  for (const status of ['OPEN', 'PENDING_APPROVAL', 'REJECTED']) {
    const a = quoteActions(quote({ status }))
    assert.deepEqual([a.edit, a.withdraw], [true, true], status)
    assert.equal(a.lockedReason, null, status)
  }
})

test('4-7. staff, sales-rep, legacy and other buyers’ quotes hide them: the server says no, so the page says no', () => {
  // The server sends canEdit/canWithdraw false for each of these (covered by the API tests); the status is changeable.
  for (const label of ['staff-created', 'rep-created', 'legacy', 'another buyer']) {
    const a = quoteActions(quote({ canEdit: false, canWithdraw: false }))
    assert.deepEqual([a.edit, a.withdraw], [false, false], label)
  }
  // And a status alone never shows them: no flag (an older response) means no.
  const noFlags = quoteActions(quote({ canEdit: undefined, canWithdraw: undefined }))
  assert.deepEqual([noFlags.edit, noFlags.withdraw], [false, false])
})

test('8-10. APPROVED, SUBMITTED, EXPIRED and WITHDRAWN quotes hide Edit and Withdraw, even with a stale flag', () => {
  for (const status of ['APPROVED', 'SUBMITTED', 'EXPIRED', 'WITHDRAWN']) {
    const a = quoteActions(quote({ status, canEdit: true, canWithdraw: true }))
    assert.deepEqual([a.edit, a.withdraw], [false, false], status)
    assert.ok(a.lockedReason, `${status} explains why`)
  }
  const converted = quoteActions(quote({ status: 'OPEN', convertedOrderId: 'o1' }))
  assert.deepEqual([converted.edit, converted.withdraw], [false, false])
  assert.match(quoteActions(quote({ status: 'WITHDRAWN' })).lockedReason!, /withdrew/)
  assert.match(quoteActions(quote({ status: 'APPROVED' })).lockedReason!, /final/)
})

// ---- 11-14: editing ----

test('11. editing only the notes sends just the notes, at the quote’s version', () => {
  const q = quote()
  const draft = { ...editDraft(q), notes: '  bigger order  ' }
  const built = buildEditBody(q, draft)
  assert.ok(built.ok)
  assert.deepEqual(built.body, { expectedVersion: 3, notes: 'bigger order' })
  // Clearing the notes sends null.
  const cleared = buildEditBody(q, { ...editDraft(q), notes: '   ' })
  assert.ok(cleared.ok)
  assert.deepEqual(cleared.body, { expectedVersion: 3, notes: null })
})

test('12. editing lines sends the whole new set: product, description, quantity and price as typed', () => {
  const q = quote()
  const draft = editDraft(q)
  draft.lines[0] = { ...draft.lines[0], qty: '12', unitPrice: '19.10' }
  draft.lines.push({ lineNo: 3, skuCode: ' INK ', description: '', qty: '2', unitPrice: '0' })
  const built = buildEditBody(q, draft)
  assert.ok(built.ok)
  assert.deepEqual(built.body, {
    expectedVersion: 3,
    lines: [
      { lineNo: 1, skuCode: 'PEN', description: 'Pens', qty: 12, unitPrice: '19.10' },
      { lineNo: 2, skuCode: 'PAD', description: 'Pads', qty: 5, unitPrice: '8.5' },
      { lineNo: 3, skuCode: 'INK', description: undefined, qty: 2, unitPrice: '0' },
    ],
  })
  assert.ok(!('notes' in built.body), 'unchanged notes are not sent')
})

test('13. pending and rejected quotes warn that saving moves the quote back to Open', () => {
  assert.match(quoteActions(quote({ status: 'PENDING_APPROVAL' })).editWarning!, /back to Open.*submit it for approval again/)
  assert.match(quoteActions(quote({ status: 'REJECTED' })).editWarning!, /back to Open/)
  assert.equal(quoteActions(quote({ status: 'OPEN' })).editWarning, null)
})

test('14. expectedVersion is the version from the latest response, never a timestamp', () => {
  const first = quote({ version: 3 })
  const latest = quote({ version: 7, notes: 'reloaded' })
  const a = buildEditBody(first, { ...editDraft(first), notes: 'x' })
  const b = buildEditBody(latest, { ...editDraft(latest), notes: 'x' })
  assert.ok(a.ok && b.ok)
  assert.deepEqual([a.body.expectedVersion, b.body.expectedVersion], [3, 7])
  const w = buildWithdrawBody(latest, '')
  assert.ok(w.ok)
  assert.equal(w.body.expectedVersion, 7)
  assert.ok(!JSON.stringify(a.body).includes('updatedAt'))
})

// ---- 15-17: withdrawing ----

test('15-16. the withdrawal body carries the version and the reason only when one is given', () => {
  const q = quote()
  const withReason = buildWithdrawBody(q, '  found another supplier ')
  assert.ok(withReason.ok)
  assert.deepEqual(withReason.body, { expectedVersion: 3, withdrawReason: 'found another supplier' })
  const without = buildWithdrawBody(q, '   ')
  assert.ok(without.ok)
  assert.deepEqual(without.body, { expectedVersion: 3 })
  const tooLong = buildWithdrawBody(q, 'x'.repeat(501))
  assert.equal(tooLong.ok, false)
})

test('17. once the refreshed quote is WITHDRAWN, every change action is gone and the reason is explained', () => {
  const a = quoteActions(quote({ status: 'WITHDRAWN', canEdit: false, canWithdraw: false, withdrawnAt: '2026-11-03T10:00:00Z' }))
  assert.deepEqual([a.edit, a.withdraw, a.counter, a.requestApproval, a.placeOrder], [false, false, false, false, false])
  assert.ok(a.lockedReason)
})

// ---- 18-20: errors, validation, duplicates ----

test('18. a 409 reads as a conflict with reload guidance; other statuses get their own messages', () => {
  const conflict = actionError(httpError(409, 'This quote was changed at the same time by someone else. Reload it and try again.'))
  assert.equal(conflict.kind, 'conflict')
  assert.match(conflict.message, /Reload to see the latest version/)
  assert.match(conflict.message, /unsaved changes stay/)
  // Found in the browser run: the server's own "Reload it and try again." was repeated before the guidance.
  assert.equal(
    conflict.message,
    'This quote was changed at the same time by someone else. Reload to see the latest version; your unsaved changes stay here until you do.',
  )
  const ordered = actionError(httpError(409, 'The quote changed while placing the order; reload and try again'))
  assert.match(ordered.message, /^The quote changed while placing the order\. Reload to see/)
  assert.equal(ordered.message.match(/reload/gi)?.length, 1)
  const approved = actionError(httpError(409, 'This quote was approved at the same time, so its terms are now final. Reload it.'))
  assert.match(approved.message, /^This quote was approved at the same time, so its terms are now final\. Reload to see/)
  assert.equal(approved.message.match(/reload/gi)?.length, 1)
  assert.match(actionError(httpError(409)).message, /^This quote was changed since you opened it\. Reload/)
  assert.equal(actionError(httpError(409)).kind, 'conflict')
  assert.deepEqual(actionError(httpError(403, 'Only the buyer who created this quote in the portal can change it.')), {
    kind: 'forbidden',
    message: 'Only the buyer who created this quote in the portal can change it.',
  })
  assert.equal(actionError(httpError(404)).kind, 'not-found')
  assert.match(actionError(httpError(503)).message, /try again in a few minutes/)
  assert.match(actionError(httpError(503, 'The order could not be confirmed… try again in a few minutes.')).message, /could not be confirmed/, 'server guidance kept')
  assert.deepEqual(actionError(httpError(400, 'A approved quote can’t be edited')), { kind: 'invalid', message: 'A approved quote can’t be edited' })
})

test('19. invalid edits are caught before sending, with the reason', () => {
  const q = quote()
  const withLine = (patch: Record<string, string>) => {
    const d = editDraft(q)
    d.lines[0] = { ...d.lines[0], ...patch }
    return d
  }
  for (const [label, draft, pattern] of [
    ['quantity 0', withLine({ qty: '0' }), /quantity/],
    ['fractional quantity', withLine({ qty: '1.5' }), /quantity/],
    ['too many', withLine({ qty: '1000001' }), /at most 1,000,000/],
    ['negative price', withLine({ unitPrice: '-1' }), /unit price/],
    ['5 decimals', withLine({ unitPrice: '1.12345' }), /4 decimal places/],
    ['exponent', withLine({ unitPrice: '1e3' }), /unit price/],
    ['no product', withLine({ skuCode: ' ' }), /choose a product/],
  ] as const) {
    assert.match(editProblem(draft) ?? '', pattern, label)
    assert.equal(buildEditBody(q, draft).ok, false, label)
  }
  const dup = editDraft(q)
  dup.lines[1] = { ...dup.lines[1], lineNo: 1 }
  assert.match(editProblem(dup)!, /Duplicate/)
  assert.match(editProblem({ ...editDraft(q), lines: [] })!, /at least one line/)
  assert.match(editProblem({ ...editDraft(q), notes: 'x'.repeat(2001) })!, /Notes/)
  const nothing = buildEditBody(q, editDraft(q))
  assert.deepEqual(nothing, { ok: false, error: 'There are no changes to save' })
})

test('20. a double click sends one request: a second call while the first is in flight is ignored', async () => {
  const guard = singleFlight()
  let calls = 0
  let release!: () => void
  const slow = () =>
    new Promise<string>((resolve) => {
      calls += 1
      release = () => resolve('done')
    })
  const first = guard.run(slow)
  assert.equal(guard.busy, true)
  const second = await guard.run(slow)
  assert.equal(second, undefined, 'ignored')
  release()
  assert.equal(await first, 'done')
  assert.equal(calls, 1)
  assert.equal(guard.busy, false)
  // A failed request frees the guard for a retry.
  await assert.rejects(guard.run(async () => { throw new Error('boom') }))
  assert.equal(await guard.run(async () => 'retry'), 'retry')
})

// ---- 21-22: counter-offers and the existing workflow ----

test('21. approved quotes offer no new counter-offer and no acceptance; open quotes still do', () => {
  const approved = quote({ status: 'APPROVED' })
  assert.equal(quoteActions(approved).counter, false)
  assert.equal(canAcceptOffer(approved, { status: 'OPEN', offeredBy: 'ADMIN' }), false)
  for (const status of ['OPEN', 'PENDING_APPROVAL', 'REJECTED']) {
    assert.equal(quoteActions(quote({ status })).counter, true, status)
    assert.equal(canAcceptOffer(quote({ status }), { status: 'OPEN', offeredBy: 'ADMIN' }), true, status)
  }
  const open = quote()
  assert.equal(canAcceptOffer(open, { status: 'OPEN', offeredBy: 'BUYER' }), false, 'never your own offer')
  assert.equal(canAcceptOffer(open, { status: 'SUPERSEDED', offeredBy: 'ADMIN' }), false)
  assert.equal(canAcceptOffer(open, { status: 'ACCEPTED', offeredBy: 'ADMIN' }), false)
  for (const status of ['SUBMITTED', 'EXPIRED', 'WITHDRAWN']) {
    assert.equal(quoteActions(quote({ status })).counter, false, status)
    assert.equal(canAcceptOffer(quote({ status }), { status: 'OPEN', offeredBy: 'ADMIN' }), false, status)
  }
})

test('22. the existing buyer workflow is unchanged: submit for approval, then place the order', () => {
  assert.equal(quoteActions(quote({ status: 'OPEN' })).requestApproval, true)
  assert.equal(quoteActions(quote({ status: 'REJECTED' })).requestApproval, true)
  assert.equal(quoteActions(quote({ status: 'PENDING_APPROVAL' })).requestApproval, false)
  assert.equal(quoteActions(quote({ status: 'APPROVED' })).placeOrder, true)
  assert.equal(quoteActions(quote({ status: 'SUBMITTED', convertedOrderId: 'o1' })).placeOrder, false)
  // Quotes the buyer can't edit still get the normal workflow (e.g. one staff raised for them).
  const staffQuote = quoteActions(quote({ canEdit: false, canWithdraw: false }))
  assert.deepEqual([staffQuote.requestApproval, staffQuote.counter], [true, true])
  // The edit form starts from the quote exactly as loaded.
  assert.deepEqual(editDraft(quote()), {
    notes: 'first draft',
    lines: [
      { lineNo: 1, skuCode: 'PEN', description: 'Pens', qty: '10', unitPrice: '20' },
      { lineNo: 2, skuCode: 'PAD', description: 'Pads', qty: '5', unitPrice: '8.5' },
    ],
  })
})
