/**
 * Browser checks of the bank reconciliation workflow on the synthetic BANKTEST tenant (fixture.ts).
 * Run only through launch.mjs (see README.md). Every request that is not to the local demo server
 * is aborted, and the only data used is the synthetic fixture and the CSV files in ./fixtures.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'

const BASE = process.env.BANKTEST_DEMO_BASE_URL ?? ''
const TMP = process.env.BANKTEST_DEMO_TMP ?? ''
const PASSWORD = process.env.BANKTEST_DEMO_PASSWORD ?? ''
const SHOTS = process.env.BANKTEST_DEMO_SHOTS ?? path.join(TMP, 'screenshots')
const FIXTURES = path.resolve('e2e', 'bank-reconciliation-local', 'fixtures')
const VALID_CSV = fs.readFileSync(path.join(FIXTURES, 'banktest-statement-2026-09.csv'))
const BAD_CSV = fs.readFileSync(path.join(FIXTURES, 'banktest-statement-malformed.csv'))
const USERS = {
  accountant: 'banktest-accountant@example.test',
  preparer: 'banktest-preparer@example.test',
  admin: 'banktest-admin@example.test',
  sales: 'banktest-sales@example.test',
}
const SEPT = '2026-09-01 to 2026-09-30'
const OCT = '2026-10-01 to 2026-10-31'
const RAW_ID = /^c[a-z0-9]{20,31}$/

type Result = { name: string; ok: boolean; detail: string }
const results: Result[] = []
const blocked = new Set<string>()
let ids: { bankAccountId: string; feeDraftId: string; lateDraftId: string }
let septId = ''

function check(name: string, ok: unknown, detail = '') {
  results.push({ name, ok: !!ok, detail })
  expect.soft(!!ok, `${name}${detail ? ` — ${detail}` : ''}`).toBe(true)
}

/** Screenshot with `at` (a locator, or 'top') scrolled to the top of the app's scroll area. */
async function shot(page: Page, name: string, at: Locator | 'top' = 'top') {
  if (at === 'top') {
    await page.evaluate(() => document.querySelectorAll('*').forEach((el) => el.scrollHeight > el.clientHeight && (el.scrollTop = 0)))
  } else {
    await at.first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.evaluate(() => document.querySelectorAll('main, [class*="overflow"]').forEach((el) => (el.scrollTop = Math.max(0, el.scrollTop - 90))))
  }
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}
const card = (page: Page, title: string | RegExp) => page.locator('.pleros-card', { has: page.getByRole('heading', { name: title }) })

async function session(browser: Browser, email: string, viewport = { width: 1440, height: 1000 }, mobile = false) {
  // Service workers are blocked: requests they handle would bypass the route guard below.
  const context = await browser.newContext({ viewport, acceptDownloads: true, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' })
  const origin = new URL(BASE)
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if ((u.hostname === origin.hostname && u.port === origin.port) || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue()
    blocked.add(`${u.protocol}//${u.hostname}`)
    return route.abort()
  })
  const page = await context.newPage()
  page.on('dialog', (d) => void d.dismiss())
  await page.goto(`${BASE}/admin/login`)
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Password').fill(PASSWORD)
  const login = page.waitForResponse((r) => r.url().includes('/api/v1/auth/login'))
  await page.getByRole('button', { name: 'Continue' }).click()
  const res = await login
  check(`login ${email.split('@')[0]}`, res.status() === 200, `HTTP ${res.status()}`)
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 }).catch(() => undefined)
  return { context, page }
}

async function openRecon(page: Page, period?: string) {
  await page.goto(`${BASE}/admin/finance`)
  await page.getByRole('button', { name: 'Bank recon' }).click()
  await page.getByText('Bank reconciliation', { exact: true }).first().waitFor()
  if (period) await selectPeriod(page, period)
}

async function selectPeriod(page: Page, period: string) {
  const select = page.getByLabel('Statement period')
  await expect(select.locator('option', { hasText: period })).toHaveCount(1)
  const value = await select.locator('option', { hasText: period }).getAttribute('value')
  await select.selectOption(value!)
  await periodHeader(page, period).waitFor()
}

/** The workspace header line ("Period … · version n"), unique on the page. */
const periodHeader = (page: Page, period: string) => page.getByText(new RegExp(`^Period ${period} · version`))

/** Click, wait for the mutation response, then for the workspace refetch. */
async function mutate(page: Page, click: () => Promise<void>, urlPart: string, method = 'POST') {
  const resP = page.waitForResponse((r) => r.url().includes(urlPart) && r.request().method() === method)
  await click()
  const res = await resP
  await page
    .waitForResponse((r) => /\/bank-reconciliations\/[^/?]+$/.test(new URL(r.url()).pathname) && r.request().method() === 'GET', { timeout: 8000 })
    .catch(() => undefined)
  await page.waitForTimeout(400)
  let body: any = null // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = await res.json()
  } catch {
    // not JSON
  }
  return { status: res.status(), body }
}

/** Calls the API with the signed-in user's token, from inside the page. */
async function apiCall(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const keys = Object.keys(localStorage).filter((k) => k.toLowerCase().includes('access'))
      const token = keys.map((k) => localStorage.getItem(k)).find(Boolean)
      const r = await fetch(`/api/v1${url}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      let json: unknown = null
      try {
        json = await r.json()
      } catch {
        // not JSON
      }
      return { status: r.status, body: json as any } // eslint-disable-line @typescript-eslint/no-explicit-any
    },
    { method, url, body },
  )
}
const workspace = async (page: Page, id = septId) => (await apiCall(page, 'GET', `/bank-reconciliations/${id}`)).body

async function legacyOpeningTile(page: Page) {
  const tile = page.locator('.pleros-card', { hasText: 'Account opening balance' }).locator('.font-mono').first()
  return (await tile.textContent())?.trim() ?? ''
}

/**
 * Runs in the page: elements of the reconciliation that reach past the right edge of the screen
 * without a horizontally scrollable container between them and the section (so the user could not
 * scroll to them). An ancestor that clips with overflow hidden would hide them, which also counts.
 */
function spillingElements(): string[] {
  const section = document.querySelector('section[aria-label="Bank reconciliation"]')
  if (!section) return ['section not found']
  const out: string[] = []
  for (const el of section.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.right <= window.innerWidth + 1) continue
    let scrollable = false
    for (let a = el.parentElement; a && a !== section.parentElement; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX
      if ((ox === 'auto' || ox === 'scroll') && a.getBoundingClientRect().right <= window.innerWidth + 1) {
        scrollable = true
        break
      }
    }
    if (!scrollable) out.push(`${el.tagName.toLowerCase()}${el.closest('.pleros-card')?.querySelector('h3')?.textContent ? ` in "${el.closest('.pleros-card')!.querySelector('h3')!.textContent!.slice(0, 30)}"` : ''}`)
    if (out.length >= 5) break
  }
  return out
}

const bankBox = (page: Page, desc: string, nth = 0) => page.getByLabel(`Select bank item ${desc}`, { exact: true }).nth(nth)
const bookBox = (page: Page, desc: string) => page.getByLabel(`Select book item ${desc}`, { exact: true })

test.describe.serial('bank reconciliation (local BANKTEST demo)', () => {
  test.beforeAll(() => {
    ids = JSON.parse(fs.readFileSync(path.join(TMP, 'fixture-ids.json'), 'utf8'))
    fs.mkdirSync(SHOTS, { recursive: true })
  })

  test.afterAll(() => {
    fs.writeFileSync(path.join(SHOTS, 'ui-results.json'), JSON.stringify({ results, blockedHosts: [...blocked] }, null, 2))
  })

  test('desktop workflow: import, match, sign-off, lock, PDF, reopen, roles', async ({ browser }) => {
    // ---------------------------------------------------------------- accountant prepares
    const acct = await session(browser, USERS.accountant)
    const p = acct.page
    await openRecon(p)
    check('UI: bank account selector lists BANKTEST Operating', (await p.getByLabel('Bank account').inputValue()) !== '')
    await p.getByRole('button', { name: 'New statement period' }).click()
    await p.getByLabel('Period start').fill('2026-09-01')
    await p.getByLabel('Period end').fill('2026-09-30')
    await p.getByLabel('Statement opening balance').fill('1000.00')
    await p.getByLabel('Statement closing balance').fill('1700.00') // deliberately wrong; corrected later
    await p.getByLabel('Auto-match window (days)').fill('3')
    const created = await mutate(p, () => p.getByRole('button', { name: 'Create period' }).click(), '/api/v1/bank-reconciliations')
    check('create statement period', created.status === 201, `HTTP ${created.status}`)
    septId = created.body.id
    await p.getByText('Book balance (GL)').waitFor()
    await shot(p, '01-account-and-period-selection')
    let ws = await workspace(p)
    check('initial status UNRECONCILED', ws.reconciliation.status === 'UNRECONCILED', ws.reconciliation.status)
    check('book balance from GL 1000 = 1530.00', ws.balances.bookBalance === '1530.00', ws.balances.bookBalance)
    check('F-1: legacy tile shows the account opening balance before matching', /1,000\.00/.test(await legacyOpeningTile(p)), await legacyOpeningTile(p))

    // CSV validation
    const fileInput = p.getByLabel('Statement CSV file')
    await fileInput.setInputFiles({ name: 'banktest-statement-malformed.csv', mimeType: 'text/csv', buffer: BAD_CSV })
    const bad = await mutate(p, () => p.getByRole('button', { name: 'Import banktest-statement-malformed.csv' }).click(), '/import-csv')
    check('malformed CSV rejected with row errors', bad.status === 400 && bad.body.errors?.length === 4, `HTTP ${bad.status}, ${bad.body?.errors?.length} row errors`)
    await p.getByText('row(s) failed validation').first().waitFor()
    await shot(p, '03a-csv-import-validation-errors', card(p, 'Import statement CSV'))
    ws = await workspace(p)
    check('rejected CSV imported nothing', ws.unmatchedBank.length === 0, `${ws.unmatchedBank.length} bank lines`)

    await fileInput.setInputFiles({ name: 'banktest-statement-2026-09.csv', mimeType: 'text/csv', buffer: VALID_CSV })
    const good = await mutate(p, () => p.getByRole('button', { name: 'Import banktest-statement-2026-09.csv' }).click(), '/import-csv')
    check('valid CSV imported 8 rows', good.status === 201 && good.body.imported === 8, `HTTP ${good.status}, imported ${good.body?.imported}`)
    await fileInput.setInputFiles({ name: 'banktest-statement-2026-09.csv', mimeType: 'text/csv', buffer: VALID_CSV })
    const dup = await mutate(p, () => p.getByRole('button', { name: 'Import banktest-statement-2026-09.csv' }).click(), '/import-csv')
    check('same CSV again rejected as duplicate', dup.status === 409, `HTTP ${dup.status}`)
    await p.getByText('already imported').first().waitFor()
    await shot(p, '03b-csv-duplicate-file-rejected', card(p, 'Import statement CSV'))

    // Suggested automatic matches
    ws = await workspace(p)
    check('status IN_PROGRESS after import', ws.reconciliation.status === 'IN_PROGRESS')
    check(
      'suggestions: 1 exact pair; equal 75.00 amounts ambiguous; 7-day pair outside window not suggested',
      ws.autoMatchPreview.pairs.length === 1 && ws.autoMatchPreview.ambiguousStatementLineIds.length === 2,
      `${ws.autoMatchPreview.pairs.length} pair(s), ${ws.autoMatchPreview.ambiguousStatementLineIds.length} ambiguous`,
    )
    await shot(p, '04a-suggested-automatic-matches', card(p, /Suggested automatic matches/))
    const auto = await mutate(p, () => p.getByRole('button', { name: 'Apply suggested matches' }).click(), '/auto-match')
    check('apply suggestions created 1 match', auto.status === 200 && auto.body.matched === 1, `matched ${auto.body?.matched}`)
    await shot(p, '04b-suggestions-applied', card(p, /Matched \(/))
    await p.waitForTimeout(500)
    check('F-1: legacy opening balance tile still 1,000.00 after a match', /1,000\.00/.test(await legacyOpeningTile(p)), await legacyOpeningTile(p))
    await shot(p, '04c-legacy-opening-tile-after-match', p.locator('.pleros-card', { hasText: 'Account opening balance' }))

    // Manual matching
    await bankBox(p, 'BANKTEST batched deposit').check()
    await bookBox(p, 'BANKTEST receipt INV-1004').check()
    await p.getByText('Totals must be equal to match.').waitFor()
    await shot(p, '05a-manual-match-unequal-totals-blocked', card(p, /Unmatched bank items/))
    await bookBox(p, 'BANKTEST receipt INV-1005').check()
    await shot(p, '05b-manual-match-many-to-one-selected', card(p, /Unmatched bank items/))
    let m = await mutate(p, () => p.getByRole('button', { name: 'Match selected' }).click(), '/matches')
    check('many-to-one (1 bank : 2 book) matched', m.status === 201, `HTTP ${m.status}`)
    await bankBox(p, 'BANKTEST split deposit part 1').check()
    await bankBox(p, 'BANKTEST split deposit part 2').check()
    await bookBox(p, 'BANKTEST receipt INV-1006').check()
    m = await mutate(p, () => p.getByRole('button', { name: 'Match selected' }).click(), '/matches')
    check('one-to-many (2 bank : 1 book) matched', m.status === 201, `HTTP ${m.status}`)
    await bankBox(p, 'BANKTEST vendor payment BILL-2001').check()
    await bookBox(p, 'BANKTEST payment BILL-2001').check()
    m = await mutate(p, () => p.getByRole('button', { name: 'Match selected' }).click(), '/matches')
    check('outside-window pair matched manually', m.status === 201, `HTTP ${m.status}`)
    await bankBox(p, 'BANKTEST deposit', 0).check()
    await bookBox(p, 'BANKTEST receipt INV-1003').check() // wrong one on purpose
    m = await mutate(p, () => p.getByRole('button', { name: 'Match selected' }).click(), '/matches')
    check('ambiguous 75.00 matched manually', m.status === 201, `HTTP ${m.status}`)
    await shot(p, '05c-matched-groups', card(p, /Matched \(/))

    // Unmatch with a reason, then rematch correctly
    const row = p.locator('tr', { hasText: 'BANKTEST receipt INV-1003' }).filter({ has: p.getByRole('button', { name: 'Unmatch' }) })
    await row.getByRole('button', { name: 'Unmatch' }).click()
    await p.getByLabel('Reason for unmatching').fill('BANKTEST: matched to the wrong receipt')
    await shot(p, '05d-unmatch-with-reason', card(p, /Matched \(/))
    const un = await mutate(p, () => p.getByRole('button', { name: 'Confirm' }).click(), '/unmatch')
    check('unmatch with reason', un.status === 200, `HTTP ${un.status}`)
    ws = await workspace(p)
    check('unmatched items are open again', ws.unmatchedBank.filter((b: { amount: string }) => b.amount === '75.00').length === 2)
    await bankBox(p, 'BANKTEST deposit', 0).check()
    await bookBox(p, 'BANKTEST receipt INV-1002').check()
    m = await mutate(p, () => p.getByRole('button', { name: 'Match selected' }).click(), '/matches')
    await bankBox(p, 'BANKTEST deposit', 0).check()
    await bookBox(p, 'BANKTEST receipt INV-1003').check()
    const m2 = await mutate(p, () => p.getByRole('button', { name: 'Match selected' }).click(), '/matches')
    check('both 75.00 deposits rematched', m.status === 201 && m2.status === 201)
    await shot(p, '05e-after-unmatch-and-rematch', card(p, /Audit trail/))
    check('F-1: legacy opening balance tile still 1,000.00 after unmatch and rematch', /1,000\.00/.test(await legacyOpeningTile(p)), await legacyOpeningTile(p))

    // Unmatched items and in-progress state
    ws = await workspace(p)
    check(
      'unmatched: bank fee only on bank side; deposit in transit + outstanding cheque on book side',
      ws.unmatchedBank.length === 1 && ws.unmatchedBook.length === 2,
      `bank ${ws.unmatchedBank.length}, book ${ws.unmatchedBook.length}`,
    )
    await shot(p, '06-unmatched-book-and-bank-items', card(p, /Unmatched bank items/))
    await shot(p, '07-in-progress-status')
    check('status IN_PROGRESS with preparer recorded', ws.reconciliation.status === 'IN_PROGRESS' && !!ws.reconciliation.preparedById)

    // Rejection when balances do not agree
    check('difference with wrong closing balance = -35.00', ws.balances.difference === '-35.00', ws.balances.difference)
    const rej = await mutate(p, () => p.getByRole('button', { name: 'Sign off reconciliation' }).click(), '/sign-off')
    check('sign-off rejected while balances differ', rej.status === 409, `HTTP ${rej.status}`)
    const afterRej = await workspace(p)
    check('rejected sign-off changed nothing', afterRej.reconciliation.status === 'IN_PROGRESS' && afterRej.reconciliation.version === ws.reconciliation.version)
    await p.getByRole('alert').first().waitFor()
    check('rejection shows the reasons, no empty row table', (await card(p, 'Sign-off').locator('table').count()) === 0)
    await shot(p, '09-sign-off-rejected-balances-differ', card(p, 'Sign-off'))

    // Fix closing balance; book the fee through an adjusting entry; match it
    await card(p, 'Statement details').getByLabel('Statement closing balance').fill('1665.00')
    const upd = await mutate(p, () => p.getByRole('button', { name: 'Save statement details' }).click(), `/bank-reconciliations/${septId}`, 'PATCH')
    check('closing balance corrected', upd.status === 200)
    await p.goto(`${BASE}/admin/finance/journals/${ids.feeDraftId}`)
    const postFee = p.waitForResponse((r) => r.url().includes(`/journal-entries/${ids.feeDraftId}/post`))
    await p.getByRole('button', { name: 'Post entry' }).click()
    check('adjusting entry for bank fee posted (dated 2026-09-28)', (await postFee).status() === 200)
    await openRecon(p, SEPT)
    await bankBox(p, 'BANKTEST bank service fee').check()
    await bookBox(p, 'BANKTEST adjusting entry: September bank service fee').check()
    m = await mutate(p, () => p.getByRole('button', { name: 'Match selected' }).click(), '/matches')
    ws = await workspace(p)
    check(
      'adjusted book = adjusted bank = 1515.00, no blockers',
      ws.balances.adjustedBook === '1515.00' && ws.balances.adjustedBank === '1515.00' && ws.signOff.canSignOff,
      `book ${ws.balances.adjustedBook}, bank ${ws.balances.adjustedBank}, blockers ${ws.signOff.blockers.length}`,
    )
    await shot(p, '02b-balances-agree-ready-to-sign-off')
    await shot(p, '02c-sign-off-ready', card(p, 'Sign-off'))

    // ---------------------------------------------------------------- unauthorized users (negative controls)
    const prep = await session(browser, USERS.preparer)
    await openRecon(prep.page, SEPT)
    const denied = await mutate(prep.page, () => prep.page.getByRole('button', { name: 'Sign off reconciliation' }).click(), '/sign-off')
    check('preparer without sign-off permission is refused', denied.status === 403, `HTTP ${denied.status}`)
    await prep.page.getByRole('alert').first().waitFor()
    await shot(prep.page, '12a-unauthorized-preparer-sign-off-403', card(prep.page, 'Sign-off'))
    const stillOpen = await workspace(p)
    check('refused sign-off changed nothing', stillOpen.reconciliation.status === 'IN_PROGRESS' && stillOpen.reconciliation.version === ws.reconciliation.version)
    await prep.context.close()

    const sales = await session(browser, USERS.sales)
    await sales.page.goto(`${BASE}/admin/finance`)
    const salesGet = await apiCall(sales.page, 'GET', `/bank-reconciliations/${septId}`)
    const salesMatch = await apiCall(sales.page, 'POST', `/bank-reconciliations/${septId}/auto-match`, {})
    check('sales rep refused on read and write', salesGet.status === 403 && salesMatch.status === 403, `GET ${salesGet.status}, auto-match ${salesMatch.status}`)
    await sales.page.getByRole('button', { name: 'Bank recon' }).click()
    await sales.page.getByText('You do not have permission to view bank accounts').first().waitFor()
    check(
      'sales rep sees a permission message, not "No bank accounts" and no Retry',
      (await sales.page.getByText('No bank accounts').count()) === 0 &&
        (await sales.page.getByRole('region', { name: 'Bank reconciliation' }).getByRole('button', { name: 'Retry' }).count()) === 0,
    )
    await shot(sales.page, '12b-unauthorized-sales-rep')
    await sales.context.close()

    // ---------------------------------------------------------------- positive control: accountant signs off
    await shot(p, '12a2-positive-control-accountant-before-sign-off', card(p, 'Sign-off'))
    const signed = await mutate(p, () => p.getByRole('button', { name: 'Sign off reconciliation' }).click(), '/sign-off')
    check('accountant (has sign-off permission) signs off', signed.status === 200, `HTTP ${signed.status}`)
    ws = await workspace(p)
    check(
      'SIGNED_OFF with signer and timestamp recorded',
      ws.reconciliation.status === 'SIGNED_OFF' && !!ws.reconciliation.signedOffById && !!ws.reconciliation.signedOffAt,
      `${ws.people[ws.reconciliation.signedOffById] ?? ''} at ${ws.reconciliation.signedOffAt}`,
    )
    await shot(p, '08-successful-sign-off')
    const signedBalances = JSON.stringify(ws.balances)

    // Locking: UI and server refuse changes; nothing changes after sign-off
    const fileDisabled = await p.getByLabel('Statement CSV file').isDisabled()
    const applyDisabled = await p.getByRole('button', { name: 'Apply suggested matches' }).isDisabled()
    const unmatchHidden = (await p.getByRole('button', { name: 'Unmatch' }).count()) === 0
    check('locked UI: import, auto-match and unmatch disabled', fileDisabled && applyDisabled && unmatchHidden)
    const un2 = await apiCall(p, 'POST', `/bank-reconciliations/${septId}/matches/${ws.matched[0].matchId}/unmatch`, { reason: 'BANKTEST locked check' })
    const imp2 = await apiCall(p, 'POST', `/bank-reconciliations/${septId}/import-csv`, { csvText: 'date,description,amount\n2026-09-12,BANKTEST late line,5.00' })
    const json2 = await apiCall(p, 'POST', `/bank-accounts/${ids.bankAccountId}/import`, { lines: [{ postedAt: '2026-09-12', description: 'BANKTEST late JSON', amount: 5 }] })
    check('server refuses unmatch, CSV and JSON import on the signed-off period', un2.status === 409 && imp2.status === 409 && json2.status === 409, `unmatch ${un2.status}, csv ${imp2.status}, json ${json2.status}`)
    await shot(p, '10a-signed-off-period-locked', card(p, /Matched \(/))
    await p.goto(`${BASE}/admin/finance/journals/${ids.lateDraftId}`)
    const postLate = p.waitForResponse((r) => r.url().includes(`/journal-entries/${ids.lateDraftId}/post`))
    await p.getByRole('button', { name: 'Post entry' }).click()
    const lateRes = await postLate
    check('backdated journal posting into signed-off period refused', lateRes.status() === 409, `HTTP ${lateRes.status()}`)
    await p.waitForTimeout(800)
    await shot(p, '10b-backdated-posting-refused')
    check('no mutation after sign-off: balances identical after the refused attempts', JSON.stringify((await workspace(p)).balances) === signedBalances)

    // PDF export
    await openRecon(p, SEPT)
    const dl = p.waitForEvent('download')
    await p.getByRole('button', { name: 'Download PDF' }).click()
    const download = await dl
    const pdfPath = path.join(SHOTS, 'banktest-reconciliation-2026-09-30.pdf')
    await download.saveAs(pdfPath)
    const pdf = fs.readFileSync(pdfPath)
    check('PDF downloaded', pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 1000, `${download.suggestedFilename()}, ${pdf.length} bytes`)
    await shot(p, '11-pdf-export')

    // Reopen: wildcard accountant refused, admin with reason allowed
    await p.getByLabel('Reason for reopening').fill('BANKTEST: accountant tries to reopen')
    const reAcct = await mutate(p, () => p.getByRole('button', { name: 'Reopen period' }).click(), '/reopen')
    check('accountant (no explicit reopen grant) refused', reAcct.status === 403, `HTTP ${reAcct.status}`)
    await shot(p, '12c-reopen-refused-for-accountant', card(p, 'Reopen'))

    const admin = await session(browser, USERS.admin)
    await openRecon(admin.page, SEPT)
    const noReason = await mutate(admin.page, () => admin.page.getByRole('button', { name: 'Reopen period' }).click(), '/reopen')
    check('reopen without reason refused', noReason.status === 400, `HTTP ${noReason.status}`)
    await admin.page.getByLabel('Reason for reopening').fill('BANKTEST: late bank correction received')
    const reAdmin = await mutate(admin.page, () => admin.page.getByRole('button', { name: 'Reopen period' }).click(), '/reopen')
    check('tenant admin reopens with reason (positive control)', reAdmin.status === 200, `HTTP ${reAdmin.status}`)
    await admin.page.getByText('bank_recon.reopened').first().waitFor()
    await shot(admin.page, '12d-reopened-by-admin-status')
    await shot(admin.page, '12e-reopen-audit-event', card(admin.page, /Audit trail/))

    // F-8: another user sees the admin's name on the reopen row, and no raw ids anywhere in the trail.
    await openRecon(p, SEPT)
    const audit = card(p, /Audit trail/)
    await audit.getByText('bank_recon.reopened').first().waitFor()
    const reopenBy = (await audit.locator('tr', { hasText: 'bank_recon.reopened' }).locator('td').nth(2).textContent())?.trim()
    check('F-8: audit row names the reopening admin for other users', reopenBy === `Morgan Banktest <${USERS.admin}>`, reopenBy ?? '')
    const byCells = (await audit.locator('tbody tr td:nth-child(3)').allTextContents()).map((s) => s.trim())
    check('F-8: no raw user id in the audit trail', byCells.length > 0 && !byCells.some((s) => RAW_ID.test(s)), `${byCells.length} rows`)
    await shot(p, '13-audit-names-for-other-user', audit)

    // ---------------------------------------------------------------- F-5: item matched in a later period
    const interest = await apiCall(admin.page, 'POST', `/bank-accounts/${ids.bankAccountId}/import`, {
      lines: [{ postedAt: '2026-09-30', description: 'BANKTEST interest credited', amount: 5, reference: 'INT09' }],
    })
    const octRes = await apiCall(admin.page, 'POST', '/bank-reconciliations', {
      bankAccountId: ids.bankAccountId,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      statementOpeningBalance: '1670.00',
      statementClosingBalance: '1670.00',
    })
    const octWs = await workspace(admin.page, octRes.body.id)
    const intLine = octWs.unmatchedBank.find((b: { reference: string }) => b.reference === 'INT09')
    const intBook = octWs.unmatchedBook.find((b: { description: string }) => b.description === 'BANKTEST September interest booked in October')
    const octMatch = await apiCall(admin.page, 'POST', `/bank-reconciliations/${octRes.body.id}/matches`, {
      statementLineIds: [intLine?.statementLineId],
      journalLineIds: [intBook?.journalLineId],
    })
    check('F-5 setup: Sept bank credit matched in October', interest.status === 201 && octRes.status === 201 && octMatch.status === 201, `${interest.status}/${octRes.status}/${octMatch.status}`)
    await apiCall(admin.page, 'PATCH', `/bank-reconciliations/${septId}`, { statementClosingBalance: '1670.00' })
    await openRecon(p, SEPT)
    const later = card(p, /Matched in a later period/)
    await later.waitFor()
    ws = await workspace(p)
    check(
      'F-5: the October-matched item is not offered as unmatched in September',
      !ws.unmatchedBank.some((b: { reference: string }) => b.reference === 'INT09') && (await bankBox(p, 'BANKTEST interest credited').count()) === 0,
    )
    check('F-5: shown under "Matched in a later period" as outstanding at period end', (await later.getByText('Outstanding at this period end', { exact: true }).count()) === 1)
    check('F-5: it still counts in September balances; no sign-off blocker', ws.balances.unrecordedBankItems === '5.00' && ws.balances.difference === '0.00' && ws.signOff.blockers.length === 0, `blockers ${ws.signOff.blockers.join('; ')}`)
    const autoSept = await apiCall(p, 'POST', `/bank-reconciliations/${septId}/auto-match`, {})
    check('F-5: auto-match in September succeeds without a concurrency message', autoSept.status === 200 && autoSept.body.matched === 0, `HTTP ${autoSept.status}`)
    const manualSept = await apiCall(p, 'POST', `/bank-reconciliations/${septId}/matches`, { statementLineIds: [intLine?.statementLineId], journalLineIds: [intBook?.journalLineId] })
    check('F-5: matching it in September names the other period', manualSept.status === 409 && String(manualSept.body?.message).includes(OCT), `HTTP ${manualSept.status}`)
    await shot(p, '14-matched-in-later-period', later)
    await admin.context.close()
    await acct.context.close()
  })

  test('error states are explicit and retryable (F-6)', async ({ browser }) => {
    const { context, page } = await session(browser, USERS.accountant)
    const region = page.getByRole('region', { name: 'Bank reconciliation' })
    const fail = (status: number) => (route: { fulfill: (r: object) => Promise<void> }) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ message: status === 403 ? 'Forbidden' : 'BANKTEST simulated failure' }) })
    const isPeriods = (u: URL) => u.pathname === '/api/v1/bank-reconciliations' && u.searchParams.has('bankAccountId')
    const isWorkspace = (u: URL) => /^\/api\/v1\/bank-reconciliations\/[^/]+$/.test(u.pathname)
    const isEvents = (u: URL) => /^\/api\/v1\/bank-reconciliations\/[^/]+\/events$/.test(u.pathname)

    // Period list fails: explicit error with Retry, not "No periods yet".
    await page.route(isPeriods, fail(500))
    await page.goto(`${BASE}/admin/finance`)
    await page.getByRole('button', { name: 'Bank recon' }).click()
    await region.getByText('Could not load statement periods').waitFor({ timeout: 20_000 }).catch(async (e) => {
      await page.screenshot({ path: path.join(SHOTS, 'debug-f6-periods.png'), fullPage: true })
      throw e
    })
    check('F-6: period-list failure shows an error, not an empty state', (await region.getByText('No periods yet').count()) === 0)
    await shot(page, '15a-error-periods-list', region)
    await page.unroute(isPeriods)
    await region.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByLabel('Statement period').locator('option', { hasText: SEPT })).toHaveCount(1)
    check('F-6: Retry reloads the period list', true)

    // Reconciliation detail fails (September has not been loaded in this session yet).
    await page.route(isWorkspace, fail(500))
    const periodSelect = page.getByLabel('Statement period')
    await periodSelect.selectOption((await periodSelect.locator('option', { hasText: SEPT }).getAttribute('value'))!)
    await region.getByText('Could not load this reconciliation').waitFor({ timeout: 20_000 })
    check('F-6: reconciliation-detail failure shows an error with Retry', (await region.getByRole('button', { name: 'Retry' }).count()) === 1)
    await shot(page, '15b-error-reconciliation-detail', region)
    await page.unroute(isWorkspace)
    await region.getByRole('button', { name: 'Retry' }).click()
    await periodHeader(page, SEPT).waitFor()
    check('F-6: Retry loads the reconciliation', true)

    // Audit trail fails (500 → Retry), then forbidden (403 → no Retry).
    await page.route(isEvents, fail(500))
    await page.reload()
    await page.getByRole('button', { name: 'Bank recon' }).click()
    await selectPeriod(page, SEPT)
    const audit = card(page, /Audit trail/)
    await audit.getByText('Could not load the audit trail').waitFor({ timeout: 20_000 })
    check('F-6: audit-trail failure is not shown as an empty trail', (await audit.getByText('No audit events yet').count()) === 0 && (await audit.locator('table').count()) === 0)
    await shot(page, '15c-error-audit-trail', audit)
    await page.unroute(isEvents)
    await audit.getByRole('button', { name: 'Retry' }).click()
    await audit.locator('table').waitFor()
    check('F-6: Retry loads the audit trail', (await audit.locator('tbody tr').count()) > 0)
    await page.route(isEvents, fail(403))
    await page.reload()
    await page.getByRole('button', { name: 'Bank recon' }).click()
    await selectPeriod(page, SEPT)
    await audit.getByText('You do not have permission to view the audit trail').waitFor({ timeout: 20_000 })
    check('F-6: forbidden audit trail says so and offers no Retry', (await audit.getByRole('button', { name: 'Retry' }).count()) === 0)
    await shot(page, '15d-forbidden-audit-trail', audit)
    await page.unroute(isEvents)

    // GL accounts fail on the unlinked account; and its empty period list is a real empty state.
    const isGl = (u: URL) => u.pathname === '/api/v1/chart-accounts'
    await page.route(isGl, fail(500))
    await page.getByLabel('Bank account').selectOption({ label: 'BANKTEST Payroll (unlinked)' })
    await region.getByText('Could not load GL accounts').waitFor({ timeout: 20_000 })
    check('F-6: GL-account failure shows an error, not an empty select', (await region.getByRole('button', { name: 'Retry' }).count()) === 1)
    check('F-6: an account with no periods shows the empty state', (await page.getByLabel('Statement period').locator('option', { hasText: 'No periods yet' }).count()) === 1)
    await shot(page, '15e-error-gl-accounts-and-empty-periods', region)
    await page.unroute(isGl)
    await region.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByLabel('GL cash account').locator('option', { hasText: 'Select an asset account' })).toHaveCount(1)
    check('F-6: Retry loads the GL accounts', true)
    await context.close()
  })

  test('phone and tablet layout: no page overflow, every control usable (F-7)', async ({ browser }) => {
    // 375 and 360: phones (tables scroll by the global rule below 768px). 768: the narrowest width
    // where tables render as plain tables, so only the cards' own overflow wrappers keep them in.
    for (const width of [375, 360, 768]) {
      const { context, page } = await session(browser, USERS.accountant, { width, height: width < 768 ? 812 : 1024 }, width < 768)
      // October gets one line that suggests a pair, before this page loads (and caches) any period.
      if (width === 375) {
        const octId = (await apiCall(page, 'GET', `/bank-reconciliations?bankAccountId=${ids.bankAccountId}`)).body.find(
          (r: { periodStart: string }) => r.periodStart === '2026-10-01',
        ).id
        const imp = await apiCall(page, 'POST', `/bank-reconciliations/${octId}/import-csv`, {
          csvText: 'date,description,amount,reference\n2026-10-02,BANKTEST deposit INV-1007 cleared,50.00,R1007',
          fileName: 'banktest-october.csv',
        })
        check('F-7 setup: October line that suggests one pair', imp.status === 201, `HTTP ${imp.status}`)
      }
      await openRecon(page, SEPT)
      await page.getByText('Book balance (GL)').waitFor()
      await page.waitForTimeout(500)
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }))
      check(`F-7: no horizontal page overflow at ${width}px`, overflow.doc <= 0 && overflow.body <= 0, `document +${overflow.doc}px, body +${overflow.body}px`)
      const spillSept = await page.evaluate(spillingElements)
      check(`F-7: nothing spills past the screen outside a scrollable card at ${width}px`, spillSept.length === 0, spillSept.join(', ') || 'none')

      // Every visible control of the reconciliation can be brought on screen and is not covered.
      const region = page.getByRole('region', { name: 'Bank reconciliation' })
      const controls = region.locator('button, input, select')
      const n = await controls.count()
      const unusable: string[] = []
      let checked = 0
      for (let i = 0; i < n; i++) {
        const el = controls.nth(i)
        if (!(await el.isVisible())) continue
        await el.scrollIntoViewIfNeeded()
        const ok = await el.evaluate((node) => {
          const r = node.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return false
          if (r.left < -1 || r.right > window.innerWidth + 1) return false
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return !!hit && (hit === node || node.contains(hit) || hit.contains(node) || (node as HTMLElement).labels?.[0]?.contains(hit) === true)
        })
        checked++
        if (!ok) unusable.push((await el.getAttribute('aria-label')) ?? ((await el.textContent()) ?? '').trim().slice(0, 40))
      }
      check(`F-7: every visible control reachable and not covered at ${width}px`, checked > 10 && unusable.length === 0, `${checked} controls; unusable: ${unusable.join(', ') || 'none'}`)

      // The two cards of finding F-7 with tables in them: October with one suggested pair, and the
      // row-error table of a rejected CSV import, both at this width.
      await selectPeriod(page, OCT)
      await card(page, /Suggested automatic matches \(1\)/).locator('table').waitFor({ timeout: 20_000 })
      await page.getByLabel('Statement CSV file').setInputFiles({ name: 'banktest-statement-malformed.csv', mimeType: 'text/csv', buffer: BAD_CSV })
      const badMobile = await mutate(page, () => page.getByRole('button', { name: 'Import banktest-statement-malformed.csv' }).click(), '/import-csv')
      await card(page, 'Import statement CSV').locator('table').waitFor()
      const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      const spill = await page.evaluate(spillingElements)
      check(
        `F-7: import-error and suggestion tables scroll inside their cards at ${width}px`,
        badMobile.status === 400 && overflow2 <= 0 && spill.length === 0,
        `import HTTP ${badMobile.status}, document +${overflow2}px, spilling: ${spill.join(', ') || 'none'}`,
      )
      const octControls = region.locator('button, input, select')
      const octUnusable: string[] = []
      let octChecked = 0
      for (let i = 0; i < (await octControls.count()); i++) {
        const el = octControls.nth(i)
        if (!(await el.isVisible())) continue
        await el.scrollIntoViewIfNeeded()
        const ok = await el.evaluate((node) => {
          const r = node.getBoundingClientRect()
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return r.left >= -1 && r.right <= window.innerWidth + 1 && !!hit && (hit === node || node.contains(hit) || hit.contains(node))
        })
        octChecked++
        if (!ok) octUnusable.push((await el.getAttribute('aria-label')) ?? ((await el.textContent()) ?? '').trim().slice(0, 40))
      }
      check(`F-7: every control usable with the tables shown at ${width}px`, octChecked > 10 && octUnusable.length === 0, `${octChecked} controls; unusable: ${octUnusable.join(', ') || 'none'}`)
      if (width === 375) {
        await shot(page, '16i-mobile-import-errors-table', card(page, 'Import statement CSV'))
        await shot(page, '16j-mobile-suggestions-table', card(page, /Suggested automatic matches/))
      }
      await selectPeriod(page, SEPT)

      if (width === 375) {
        // Use controls on the phone: open and cancel an unmatch, tick a box, then untick it.
        await page.getByRole('button', { name: 'Unmatch' }).first().click()
        await page.getByLabel('Reason for unmatching').fill('BANKTEST mobile check')
        await page.getByRole('button', { name: 'Cancel' }).first().click()
        check('F-7: unmatch form opens and cancels on a phone', (await page.getByLabel('Reason for unmatching').count()) === 0)
        await shot(page, '16a-mobile-top')
        await shot(page, '16b-mobile-balances', page.getByText('Book balance (GL)'))
        await shot(page, '16c-mobile-import-card', card(page, 'Import statement CSV'))
        await shot(page, '16d-mobile-suggestions-card', card(page, /Suggested automatic matches/))
        await shot(page, '16e-mobile-matched', card(page, /Matched \(/))
        await shot(page, '16f-mobile-later-period', card(page, /Matched in a later period/))
        await shot(page, '16g-mobile-sign-off', card(page, 'Sign-off'))
        await shot(page, '16h-mobile-audit', card(page, /Audit trail/))
      }
      await context.close()
    }
    check('requests to any other host were aborted by the route guard (none sent)', true, [...blocked].join(', ') || 'none attempted')
  })
})
