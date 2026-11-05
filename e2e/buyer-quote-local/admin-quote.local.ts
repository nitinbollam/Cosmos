/**
 * Browser checks of the admin quote page (Ticket #3, Phase 7) on the synthetic QTEST tenants: approval and
 * rejection with the displayed version, stale-view conflicts, withdrawn quote history, counter-offer
 * restrictions, permission-based actions and tenant isolation. Run only through launch.mjs (--spec admin).
 * Every request that is not to the local server is aborted. Buyer-side setup goes through the buyer API.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Browser, type Page, type Request } from '@playwright/test'

const BASE = process.env.BANKTEST_DEMO_BASE_URL ?? ''
const TMP = process.env.BANKTEST_DEMO_TMP ?? ''
const PASSWORD = process.env.QTEST_DEMO_PASSWORD ?? ''
const SHOTS = process.env.QTEST_SHOTS ?? path.join(TMP, 'screenshots')
const USERS = {
  buyer: 'qtest-buyer@example.test',
  manager: 'qtest-manager@example.test',
  reader: 'qtest-reader@example.test',
  otherManager: 'qtest-other-manager@example.test',
}
const ids = JSON.parse(fs.readFileSync(path.join(TMP, 'fixture-ids.json'), 'utf8')) as {
  customerId: string
  expiredQuoteId: string
  legacyQuoteId: string
}
const STALE = 'This quote has changed since you opened it. Reload the latest version before continuing.'

type Result = { name: string; ok: boolean; detail: string }
const results: Result[] = []
const blocked = new Set<string>()
const consoleErrors: string[] = []
const httpErrors: string[] = []

function check(name: string, ok: unknown, detail = '') {
  results.push({ name, ok: !!ok, detail })
  expect.soft(!!ok, `${name}${detail ? ` — ${detail}` : ''}`).toBe(true)
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage })
}

/** API calls as a given user, with their own token (setup, and reading back what the server stored). */
const tokens = new Map<string, string>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function as(user: string, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  if (!tokens.has(user)) {
    const r = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user, password: PASSWORD }),
    })
    tokens.set(user, ((await r.json()) as { accessToken: string }).accessToken)
  }
  const r = await fetch(`${BASE}/api/v1${url}`, {
    method,
    headers: { authorization: `Bearer ${tokens.get(user)}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const LINES = [
  { lineNo: 1, skuCode: 'QT-PEN-01', description: 'Pens', qty: 10, unitPrice: 20 },
  { lineNo: 2, skuCode: 'QT-PAD-02', description: 'Pads', qty: 5, unitPrice: 8 },
]
/** A buyer quote, optionally sent for approval. */
async function buyerQuote(notes: string, pending = true) {
  const r = await as(USERS.buyer, 'POST', '/quotes', { customerRef: ids.customerId, notes, lines: LINES })
  if (r.status !== 201) throw new Error(`setup quote: HTTP ${r.status} ${JSON.stringify(r.body)}`)
  if (pending) {
    const p = await as(USERS.buyer, 'POST', `/quotes/${r.body.id}/request-approval`, {})
    if (p.status !== 200) throw new Error(`setup approval request: HTTP ${p.status}`)
    return p.body as { id: string; version: number; quoteNumber: string }
  }
  return r.body as { id: string; version: number; quoteNumber: string }
}
const quoteNow = async (id: string) => (await as(USERS.manager, 'GET', `/quotes/${id}`)).body as { status: string; version: number; lines: Array<{ qty: number; unitPrice: string }> }

/** The buyer changes the quote and sends it for approval again: same status, newer version. */
async function buyerChangesAndResubmits(id: string, qty: number) {
  const q = await quoteNow(id)
  const e = await as(USERS.buyer, 'PATCH', `/quotes/${id}`, { expectedVersion: q.version, lines: [{ ...LINES[0], qty }, LINES[1]] })
  if (e.status !== 200) throw new Error(`buyer edit: HTTP ${e.status} ${JSON.stringify(e.body)}`)
  const p = await as(USERS.buyer, 'POST', `/quotes/${id}/request-approval`, {})
  if (p.status !== 200) throw new Error(`buyer resubmit: HTTP ${p.status}`)
  return p.body as { version: number }
}

async function adminSession(browser: Browser, user: string, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
  const origin = new URL(BASE)
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    const local = (u.hostname === origin.hostname && u.port === origin.port) || u.protocol === 'data:' || u.protocol === 'blob:'
    if (local) return route.continue()
    blocked.add(`${u.protocol}//${u.hostname}`)
    return route.abort()
  })
  const page = await context.newPage()
  page.on('dialog', (d) => void d.dismiss())
  page.on('response', (r) => {
    if (r.status() >= 400) httpErrors.push(`${user.split('@')[0]}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200))
  })
  await page.goto(`${BASE}/admin/login`)
  await page.getByPlaceholder('Email').fill(user)
  await page.getByPlaceholder('Password').fill(PASSWORD)
  const login = page.waitForResponse((r) => r.url().includes('/api/v1/auth/login'))
  await page.getByRole('button', { name: 'Continue' }).click()
  const res = await login
  check(`${user.split('@')[0]} signs in to admin`, res.status() === 200, `HTTP ${res.status()}`)
  await page.waitForURL((u) => !u.pathname.startsWith('/admin/login'), { timeout: 20000 })
  return { context, page }
}

/** Every request the page sends to one quote action, with its JSON body. */
function capture(page: Page, action: string) {
  const sent: Array<Record<string, unknown>> = []
  const on = (r: Request) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith(action)) sent.push((r.postDataJSON() ?? {}) as Record<string, unknown>)
  }
  page.on('request', on)
  return sent
}

async function openList(page: Page, filter: string) {
  await page.goto(`${BASE}/admin/quotes`)
  await page.getByRole('heading', { name: 'Quote approvals' }).waitFor()
  if (filter !== 'PENDING_APPROVAL') {
    const res = page.waitForResponse((r) => r.url().includes('/api/v1/quotes') && r.request().method() === 'GET')
    await page.getByRole('button', { name: filter.replace(/_/g, ' '), exact: true }).click()
    await res
  }
  await page.waitForTimeout(300)
}
const row = (page: Page, id: string) => page.locator(`tr[data-quote-id="${id}"]`)
const detailDialog = (page: Page) => page.getByRole('dialog', { name: /^Quote / })
const rejectDialog = (page: Page) => page.getByRole('dialog', { name: /^Reject quote/ })
async function openDetail(page: Page, id: string) {
  await row(page, id).getByRole('button', { name: 'View' }).click()
  await detailDialog(page).waitFor()
  await page.waitForTimeout(400) // counter-offers load next to the quote
}
const buttonCount = (scope: ReturnType<Page['locator']>, name: string) => scope.getByRole('button', { name, exact: true }).count()

test('admin quote page (Phase 7)', async ({ browser }) => {
  fs.mkdirSync(SHOTS, { recursive: true })

  // ---------- setup through the buyer API ----------
  const qApprove = await buyerQuote('QTEST admin approve')
  const offerBeforeApproval = await as(USERS.buyer, 'POST', `/quotes/${qApprove.id}/counter-offers`, {
    lines: [{ lineNo: 1, qty: 10, unitPrice: '19' }],
  })
  check('setup: buyer counter-offer on the quote to be approved', offerBeforeApproval.status === 201, `HTTP ${offerBeforeApproval.status}`)
  const qReject = await buyerQuote('QTEST admin reject')
  const qStaleApprove = await buyerQuote('QTEST stale approve')
  const qStaleReject = await buyerQuote('QTEST stale reject')
  const qCounter = await buyerQuote('QTEST counter-offers', false)
  const buyerOffer = await as(USERS.buyer, 'POST', `/quotes/${qCounter.id}/counter-offers`, {
    // A full offer: accepting replaces the quote's lines with the offer's (existing server behaviour).
    lines: [
      { lineNo: 1, qty: 10, unitPrice: '20' },
      { lineNo: 2, qty: 6, unitPrice: '7.5' },
    ],
  })
  check('setup: buyer counter-offer on an open quote', buyerOffer.status === 201)
  const qWithdrawn = await buyerQuote('QTEST withdrawn', false)
  const wd = await as(USERS.buyer, 'POST', `/quotes/${qWithdrawn.id}/withdraw`, {
    expectedVersion: qWithdrawn.version,
    withdrawReason: 'QTEST: ordering elsewhere',
  })
  check('setup: buyer withdraws a quote', wd.status === 200, `HTTP ${wd.status}`)

  const { context, page } = await adminSession(browser, USERS.manager)

  // ---------- 16. existing workflow: pending list, approve with the displayed version ----------
  await openList(page, 'PENDING_APPROVAL')
  check('pending list shows the buyer quotes', (await row(page, qApprove.id).count()) === 1 && (await row(page, qReject.id).count()) === 1)
  const number = (await as(USERS.buyer, 'GET', `/quotes/${qApprove.id}`)).body.quoteNumber as string
  check('quote number matches the one the buyer sees', !!number && (await row(page, qApprove.id).innerText()).includes(number), number)
  await shot(page, 'p7-01-pending-list')
  const approves = capture(page, '/approve')
  await openDetail(page, qApprove.id)
  const d = detailDialog(page)
  check('detail shows customer, lines and total', /QTEST Buyer Co/.test(await d.innerText()) && /\$240\.00 total/.test(await d.innerText()))
  check('detail of a pending quote offers Approve, Reject and the counter-offer form', (await buttonCount(d, 'Approve')) === 1 && (await buttonCount(d, 'Reject')) === 1 && (await buttonCount(d, 'Send counter')) === 1)
  await shot(page, 'p7-02-pending-detail')
  const approved = page.waitForResponse((r) => r.url().endsWith(`/quotes/${qApprove.id}/approve`))
  await d.getByRole('button', { name: 'Approve', exact: true }).click()
  const ar = await approved
  check('10. approval sends the displayed version as expectedVersion', approves.length === 1 && approves[0].expectedVersion === qApprove.version, JSON.stringify(approves))
  check('approval succeeds', ar.status() === 200, `HTTP ${ar.status()}`)
  await expect(d.getByText(/^Approved /)).toBeVisible()

  // ---------- 5 / 9. approved: no counter-offer actions; the earlier buyer offer is SUPERSEDED, not acceptable ----------
  const dt = await d.innerText()
  check('approved quote shows its approval date', /Approved \d/.test(dt))
  check('5. approved quote: no counter-offer form, no Approve/Reject', (await buttonCount(d, 'Send counter')) === 0 && (await buttonCount(d, 'Approve')) === 0 && (await buttonCount(d, 'Reject')) === 0)
  check('approved quote explains its terms are final', /approved, so its terms are final/i.test(dt))
  const offerLi = d.locator(`li[data-offer-id="${offerBeforeApproval.body.id}"]`)
  check('9. the earlier buyer offer is shown SUPERSEDED with an explanation', /SUPERSEDED/.test(await offerLi.innerText()) && /can no longer be accepted/.test(await offerLi.innerText()))
  check('9. superseded offer has no Accept action', (await offerLi.getByRole('button').count()) === 0)
  await shot(page, 'p7-03-approved-detail-superseded')
  await d.getByRole('button', { name: 'Close' }).click()

  // ---------- 11. rejection with the displayed version ----------
  const rejects = capture(page, '/reject')
  await openList(page, 'PENDING_APPROVAL')
  await row(page, qReject.id).getByRole('button', { name: 'Reject' }).click()
  await rejectDialog(page).getByLabel('Reason').fill('QTEST: prices need review')
  await shot(page, 'p7-04-reject-dialog')
  const rejected = page.waitForResponse((r) => r.url().endsWith(`/quotes/${qReject.id}/reject`))
  await rejectDialog(page).getByRole('button', { name: 'Reject', exact: true }).click()
  const rr = await rejected
  check('11. rejection sends the reason and the displayed version', rejects.length === 1 && rejects[0].expectedVersion === qReject.version && rejects[0].reason === 'QTEST: prices need review', JSON.stringify(rejects))
  check('rejection succeeds and the dialog closes', rr.status() === 200 && (await rejectDialog(page).count()) === 0, `HTTP ${rr.status()}`)
  check('rejected quote stored as REJECTED with the reason', (await as(USERS.manager, 'GET', `/quotes/${qReject.id}`)).body.rejectionReason === 'QTEST: prices need review')

  // ---------- 12 / 14 / 15. stale approval: 409, reload guidance, no automatic retry ----------
  await openList(page, 'PENDING_APPROVAL')
  const shownVersion = qStaleApprove.version
  const newer = await buyerChangesAndResubmits(qStaleApprove.id, 12) // after the admin loaded the list
  const approves2 = capture(page, '/approve')
  const stale = page.waitForResponse((r) => r.url().endsWith(`/quotes/${qStaleApprove.id}/approve`))
  await row(page, qStaleApprove.id).getByRole('button', { name: 'Approve' }).click()
  const sr = await stale
  check('12. stale approval returns 409', sr.status() === 409, `HTTP ${sr.status()}`)
  const alert = row(page, qStaleApprove.id).getByRole('alert')
  await expect(alert).toBeVisible()
  check('14. conflict shows the reload guidance', (await alert.innerText()).includes(STALE))
  check('14. conflict offers a reload action', (await alert.getByRole('button', { name: 'Reload latest version' }).count()) === 1)
  await shot(page, 'p7-05-stale-approve-conflict')
  await page.waitForTimeout(1500)
  check('15. no automatic retry: exactly one approve request, with the shown version', approves2.length === 1 && approves2[0].expectedVersion === shownVersion, JSON.stringify(approves2))
  check('15. the stale approval changed nothing', (await quoteNow(qStaleApprove.id)).status === 'PENDING_APPROVAL' && (await quoteNow(qStaleApprove.id)).version === newer.version)
  await alert.getByRole('button', { name: 'Reload latest version' }).click()
  await expect(row(page, qStaleApprove.id)).toContainText('$280.00') // 12 × 20 + 5 × 8
  check('reload clears the conflict and shows the buyer\'s new total', (await row(page, qStaleApprove.id).getByRole('alert').count()) === 0)
  const fresh = page.waitForResponse((r) => r.url().endsWith(`/quotes/${qStaleApprove.id}/approve`))
  await row(page, qStaleApprove.id).getByRole('button', { name: 'Approve' }).click()
  const fr = await fresh
  check('after reload, an explicit approval uses the reloaded version and succeeds', fr.status() === 200 && approves2.length === 2 && approves2[1].expectedVersion === newer.version, JSON.stringify(approves2))

  // ---------- 13. stale rejection: 409, the typed reason is kept, reload then reject ----------
  await openList(page, 'PENDING_APPROVAL')
  const rejects2 = capture(page, '/reject')
  await row(page, qStaleReject.id).getByRole('button', { name: 'Reject' }).click()
  await rejectDialog(page).getByLabel('Reason').fill('QTEST: too expensive')
  const newerR = await buyerChangesAndResubmits(qStaleReject.id, 15) // while the dialog is open
  const staleR = page.waitForResponse((r) => r.url().endsWith(`/quotes/${qStaleReject.id}/reject`))
  await rejectDialog(page).getByRole('button', { name: 'Reject', exact: true }).click()
  const srr = await staleR
  check('13. stale rejection returns 409', srr.status() === 409, `HTTP ${srr.status()}`)
  const ralert = rejectDialog(page).getByRole('alert')
  await expect(ralert).toBeVisible()
  check('13. reject dialog stays open with the reload guidance', (await ralert.innerText()).includes(STALE))
  check('13. the typed reason is kept', (await rejectDialog(page).getByLabel('Reason').inputValue()) === 'QTEST: too expensive')
  await shot(page, 'p7-06-stale-reject-conflict')
  await page.waitForTimeout(1000)
  check('13. no automatic retry of the rejection', rejects2.length === 1 && rejects2[0].expectedVersion === qStaleReject.version, JSON.stringify(rejects2))
  check('13. the stale rejection changed nothing', (await quoteNow(qStaleReject.id)).status === 'PENDING_APPROVAL')
  await ralert.getByRole('button', { name: 'Reload latest version' }).click()
  await expect(ralert).toHaveCount(0)
  check('reason still there after reload', (await rejectDialog(page).getByLabel('Reason').inputValue()) === 'QTEST: too expensive')
  const okR = page.waitForResponse((r) => r.url().endsWith(`/quotes/${qStaleReject.id}/reject`))
  await rejectDialog(page).getByRole('button', { name: 'Reject', exact: true }).click()
  check('after reload, an explicit rejection uses the reloaded version and succeeds', (await okR).status() === 200 && rejects2[1]?.expectedVersion === newerR.version, JSON.stringify(rejects2))

  // ---------- 1-4 / 8. withdrawn quote stays in history, clearly marked, with no actions ----------
  await openList(page, 'WITHDRAWN')
  check('1. withdrawn quote listed under the WITHDRAWN filter', (await row(page, qWithdrawn.id).count()) === 1)
  const wrow = await row(page, qWithdrawn.id).innerText()
  check('2. withdrawn quote shows WITHDRAWN and its date in the list', /WITHDRAWN/.test(wrow) && /Withdrawn \d/.test(wrow))
  check('4. no Approve / Reject / Create order in the withdrawn row', (await row(page, qWithdrawn.id).getByRole('button').count()) === 1) // View only
  await shot(page, 'p7-07-withdrawn-list')
  await openDetail(page, qWithdrawn.id)
  const wt = await d.innerText()
  check('3. withdrawal date and reason in the detail', /Withdrawn by the buyer on \d/.test(wt) && wt.includes('Reason: QTEST: ordering elsewhere'))
  check('history preserved: lines and total still shown', /\$240\.00 total/.test(wt) && (await d.locator('table tbody tr').count()) === 2)
  check('4 / 8. withdrawn: no Approve, Reject, counter-offer or Accept', (await d.getByRole('button').count()) === 1 && (await d.getByText('Send admin counter-offer').count()) === 0, `${await d.getByRole('button').count()} buttons`)
  check('withdrawn: explains it is kept for history', /kept for history/.test(wt))
  await shot(page, 'p7-08-withdrawn-detail')
  await d.getByRole('button', { name: 'Close' }).click()
  await openList(page, 'ALL')
  check('1. withdrawn quote also in ALL', (await row(page, qWithdrawn.id).count()) === 1)

  // ---------- 7. expired ----------
  await openDetail(page, ids.expiredQuoteId)
  check('7. expired quote: no counter-offer form or decisions', (await d.getByRole('button').count()) === 1 && /expired/i.test(await d.innerText()))
  await shot(page, 'p7-09-expired-detail')
  await d.getByRole('button', { name: 'Close' }).click()

  // ---------- legacy offers: only the one the server would let staff accept has the button ----------
  await openDetail(page, ids.legacyQuoteId)
  const accepts = await d.getByRole('button', { name: 'Accept buyer counter' }).count()
  check('legacy offers: one Accept (the BUYER-labelled one), none on the ADMIN-labelled one', accepts === 1)
  check('legacy ADMIN offer explained', /cannot be accepted safely/.test(await d.innerText()))
  await shot(page, 'p7-10-legacy-offers')
  await d.getByRole('button', { name: 'Close' }).click()

  // ---------- 16. counter-offers still work on an open quote: accept the buyer's, send a staff one ----------
  await openList(page, 'OPEN')
  await openDetail(page, qCounter.id)
  const acc = page.waitForResponse((r) => r.url().endsWith(`/quotes/${qCounter.id}/counter-offers/accept`))
  await d.getByRole('button', { name: 'Accept buyer counter' }).click()
  check('accepting the buyer counter-offer succeeds', (await acc).status() === 200)
  await expect(d.locator('table tbody tr').nth(1)).toContainText('$7.50')
  check('accepted prices applied to the quote', /\$245\.00 total/.test(await d.innerText())) // 10 × 20 + 6 × 7.5
  const counters = capture(page, '/counter-offers')
  const sent = page.waitForResponse((r) => r.url().endsWith(`/quotes/${qCounter.id}/counter-offers`) && r.request().method() === 'POST')
  await d.getByRole('button', { name: 'Send counter' }).click()
  check('sending a staff counter-offer still works (request shape unchanged)', (await sent).status() === 201 && counters[0]?.offeredBy === 'ADMIN' && Array.isArray(counters[0]?.lines) && counters[0]?.expectedVersion === undefined)
  await expect(d.getByText(/^Staff ·/)).toBeVisible()
  await shot(page, 'p7-11-counter-offers-open')
  await d.getByRole('button', { name: 'Close' }).click()

  // ---------- 6. submitted: create the order from the approved quote, then no actions ----------
  await openList(page, 'APPROVED')
  const order = page.waitForResponse((r) => r.url().endsWith(`/quotes/${qApprove.id}/submit`))
  await row(page, qApprove.id).getByRole('button', { name: 'Create order' }).click()
  check('Create order still works', (await order).status() === 200)
  await expect(page.getByText('Order created from the quote.')).toBeVisible()
  await openList(page, 'SUBMITTED')
  await openDetail(page, qApprove.id)
  check('6. submitted quote: no counter-offer form, decisions or Accept', (await d.getByRole('button').count()) === 1 && (await d.getByRole('link', { name: 'View order →' }).count()) === 1)
  await shot(page, 'p7-12-submitted-detail')
  await context.close()

  // ---------- 17. permission-based visibility: read-only staff ----------
  const pendingForReader = await buyerQuote('QTEST reader view')
  const reader = await adminSession(browser, USERS.reader)
  await openList(reader.page, 'PENDING_APPROVAL')
  const rrow = row(reader.page, pendingForReader.id)
  check('17. read-only staff see the pending quote', (await rrow.count()) === 1)
  check('17. read-only staff get no Approve / Reject', (await rrow.getByRole('button').count()) === 1)
  await openDetail(reader.page, pendingForReader.id)
  const rd = detailDialog(reader.page)
  check('17. read-only detail: no decisions or counter-offer form, and says why', (await rd.getByRole('button').count()) === 1 && /need quote write access/.test(await rd.innerText()))
  await shot(reader.page, 'p7-13-read-only-detail')
  await openList(reader.page, 'OPEN')
  await openDetail(reader.page, ids.legacyQuoteId)
  check('17. read-only staff get no Accept on an acceptable buyer offer', (await rd.getByRole('button', { name: 'Accept buyer counter' }).count()) === 0)
  const forced = await as(USERS.reader, 'POST', `/quotes/${pendingForReader.id}/approve`, { expectedVersion: pendingForReader.version })
  check('17. server still refuses a read-only approval (403)', forced.status === 403, `HTTP ${forced.status}`)
  await reader.context.close()

  // ---------- 18. tenant isolation ----------
  const other = await adminSession(browser, USERS.otherManager)
  await openList(other.page, 'ALL')
  check('18. another tenant\'s manager sees none of the QTEST quotes', (await other.page.locator('tr[data-quote-id]').count()) === 0 && (await other.page.getByText('No quotes').count()) === 1)
  await shot(other.page, 'p7-14-other-tenant-empty')
  const peek = await as(USERS.otherManager, 'GET', `/quotes/${pendingForReader.id}`)
  const cross = await as(USERS.otherManager, 'POST', `/quotes/${pendingForReader.id}/approve`, { expectedVersion: pendingForReader.version })
  const crossReject = await as(USERS.otherManager, 'POST', `/quotes/${pendingForReader.id}/reject`, { reason: 'x', expectedVersion: pendingForReader.version })
  check('18. cross-tenant read, approve and reject are 404', peek.status === 404 && cross.status === 404 && crossReject.status === 404, `${peek.status}/${cross.status}/${crossReject.status}`)
  check('18. the quote is untouched', (await quoteNow(pendingForReader.id)).status === 'PENDING_APPROVAL')
  await other.context.close()

  // ---------- phone width: the dialogs fit ----------
  const narrow = await adminSession(browser, USERS.manager, { width: 375, height: 760 })
  await openList(narrow.page, 'ALL')
  await openDetail(narrow.page, qWithdrawn.id)
  const box = await detailDialog(narrow.page).boundingBox()
  check('375px: the quote dialog fits the screen', !!box && box.x >= 0 && box.x + box.width <= 376, JSON.stringify(box))
  await shot(narrow.page, 'p7-15-phone-withdrawn-detail')
  await narrow.context.close()
})

test.afterAll(() => {
  fs.writeFileSync(
    path.join(SHOTS, 'ui-results.json'),
    JSON.stringify({ results, blocked: [...blocked], httpErrors, consoleErrors }, null, 2),
  )
  const failed = results.filter((r) => !r.ok)
  console.log(`[admin-quote] ${results.length - failed.length}/${results.length} checks passed; blocked external: ${blocked.size}`)
  for (const f of failed) console.log(`  FAIL ${f.name} ${f.detail}`)
})
