/**
 * Browser checks of buyer quote editing and withdrawal (Ticket #3, Phase 6) on the synthetic QTEST tenant.
 * Run only through launch.mjs. Every request that is not to the local server is aborted.
 * Scenario letters (A–P) and the concurrency / UI checks follow the Phase 6 browser validation request.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

const BASE = process.env.BANKTEST_DEMO_BASE_URL ?? ''
const TMP = process.env.BANKTEST_DEMO_TMP ?? ''
const PASSWORD = process.env.QTEST_DEMO_PASSWORD ?? ''
const SHOTS = process.env.QTEST_SHOTS ?? path.join(TMP, 'screenshots')
const BUYER = 'qtest-buyer@example.test'
const MANAGER = 'qtest-manager@example.test'
const ids = JSON.parse(fs.readFileSync(path.join(TMP, 'fixture-ids.json'), 'utf8')) as { customerId: string; skus: string[] }
const [PEN, PAD, INK] = ids.skus

type Result = { name: string; ok: boolean; detail: string }
const results: Result[] = []
const blocked = new Set<string>()
const consoleErrors: string[] = []
const httpErrors: string[] = []
/** Holds back one kind of request so the busy state can be seen (and double-clicked). */
let slow: { method: string; path: string; ms: number } | null = null

function check(name: string, ok: unknown, detail = '') {
  results.push({ name, ok: !!ok, detail })
  expect.soft(!!ok, `${name}${detail ? ` — ${detail}` : ''}`).toBe(true)
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage })
}

async function buyerSession(browser: Browser, viewport = { width: 1440, height: 1000 }, mobile = false) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' })
  const origin = new URL(BASE)
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    const local = (u.hostname === origin.hostname && u.port === origin.port) || u.protocol === 'data:' || u.protocol === 'blob:'
    if (local && slow && slow.method === route.request().method() && u.pathname.endsWith(slow.path)) await new Promise((r) => setTimeout(r, slow!.ms))
    if (local) return route.continue()
    blocked.add(`${u.protocol}//${u.hostname}`)
    return route.abort()
  })
  const page = await context.newPage()
  page.on('dialog', (d) => void d.dismiss())
  page.on('response', (r) => {
    if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200))
  })
  await page.goto(`${BASE}/login`)
  await page.getByPlaceholder('Email').fill(BUYER)
  await page.getByPlaceholder('Password').fill(PASSWORD)
  const login = page.waitForResponse((r) => r.url().includes('/api/v1/auth/login'))
  await page.getByRole('button', { name: 'Sign In' }).click()
  const res = await login
  check('buyer signs in to the portal', res.status() === 200, `HTTP ${res.status()}`)
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
  return { context, page }
}

/** Staff actions go straight to the API with the manager's own token (the admin quote pages are out of scope). */
let staffToken = ''
async function staff(method: string, url: string, body?: unknown) {
  if (!staffToken) {
    const r = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: MANAGER, password: PASSWORD }),
    })
    staffToken = ((await r.json()) as { accessToken: string }).accessToken
  }
  const r = await fetch(`${BASE}/api/v1${url}`, {
    method,
    headers: { authorization: `Bearer ${staffToken}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, body: (await r.json().catch(() => null)) as any } // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** The buyer's own API, from inside the page with the portal token (for setup and for reading the stored quote). */
async function buyerApi(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const token = localStorage.getItem('pleros.shop.accessToken')
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

const LINES = [
  { lineNo: 1, skuCode: 'QT-PEN-01', description: 'Pens', qty: 10, unitPrice: 20 },
  { lineNo: 2, skuCode: 'QT-PAD-02', description: 'Pads', qty: 5, unitPrice: 8 },
]
async function apiQuote(page: Page, notes: string) {
  const r = await buyerApi(page, 'POST', '/quotes', { customerRef: ids.customerId, notes, lines: LINES })
  if (r.status !== 201) throw new Error(`setup quote: HTTP ${r.status} ${JSON.stringify(r.body)}`)
  return r.body as { id: string; quoteNumber?: string }
}

const editDialog = (page: Page) => page.getByRole('dialog', { name: 'Edit quote' })
const withdrawDialog = (page: Page) => page.getByRole('dialog', { name: 'Withdraw this quote?' })
const badge = (page: Page) => page.locator('main h1 + p')
const tableRows = (page: Page) => page.locator('main table.pleros-shop-table tbody tr')
async function linesTable(page: Page) {
  return (await tableRows(page).allInnerTexts()).map((t) => t.split('\t').map((c) => c.trim()))
}
async function openQuote(page: Page, id: string, query = '') {
  await page.goto(`${BASE}/quotes/${id}${query}`)
  await page.locator('main h1').first().waitFor()
}
/** Elements wider than the viewport, and whether the page scrolls sideways. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const w = window.innerWidth
    const doc = document.scrollingElement!.scrollWidth > w + 1
    const wide = [...document.querySelectorAll('button, a, input, textarea, [role="dialog"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && (r.right > w + 1 || r.left < -1)
      })
      .map((el) => `${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}`)
    return { doc, wide }
  })
}

test('buyer quote edit and withdraw in the browser', async ({ browser }) => {
  fs.mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await buyerSession(browser)
  let mainId = ''
  let mainNumber = ''

  // ---------------- O / A: quote creation still works (shared line editor, product search) ----------------
  await test.step('A/O. buyer creates a quote', async () => {
    await page.goto(`${BASE}/quotes/new`)
    await page.getByRole('heading', { name: 'New quote' }).waitFor()
    await expect(page.locator('input.pleros-shop-field--readonly')).toHaveValue(ids.customerId)
    await page.getByLabel('Notes').fill('Initial request for Q4 supplies')
    const product = page.getByLabel('Line 1 product')
    const search = page.waitForResponse((r) => r.url().includes('/api/v1/skus?search='))
    await product.fill('QT-PEN')
    const sr = await search
    check('O. product search answers the buyer', sr.status() === 200, `HTTP ${sr.status()}`)
    await page.waitForTimeout(200)
    await product.fill(PEN)
    await expect(page.getByLabel('Line 1 description')).toHaveValue('QTEST Ballpoint pens (box)')
    check('O. picking a product fills its name and price', (await page.getByLabel('Line 1 unit price').inputValue()) === '24')
    await page.getByLabel('Line 1 quantity').fill('12')
    await shot(page, '01-new-quote-form')
    const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/quotes') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Create draft quote' }).click()
    const res = await created
    check('A. quote created', res.status() === 201, `HTTP ${res.status()}`)
    const body = await res.json()
    mainId = body.id
    mainNumber = body.quoteNumber ?? ''
    await page.waitForURL(`**/quotes/${mainId}`)
    await expect(badge(page)).toContainText('OPEN')
    check('A. detail shows the new line', JSON.stringify(await linesTable(page)).includes('QT-PEN-01'))
    await shot(page, '02-detail-open-own')
  })

  await test.step('B/C. list shows the quote with Edit and Withdraw', async () => {
    await page.goto(`${BASE}/quotes`)
    const row = page.locator('li.pleros-shop-list-card', { has: page.locator(`a[href="/quotes/${mainId}"]`) })
    await row.waitFor()
    check('B. quote appears in the buyer quote list', await row.isVisible())
    check('C. Edit shown on own OPEN quote (list)', await row.getByRole('link', { name: /^Edit/ }).isVisible())
    check('C. Withdraw shown on own OPEN quote (list)', await row.getByRole('link', { name: /^Withdraw/ }).isVisible())
    await shot(page, '03-list-own-open')
    await openQuote(page, mainId)
    check('C. Edit quote button on detail', await page.getByRole('button', { name: 'Edit quote' }).isVisible())
    check('C. Withdraw quote button on detail', await page.getByRole('button', { name: 'Withdraw quote' }).isVisible())
  })

  await test.step('D. edit notes (from the list link) + loading state + double-click', async () => {
    await page.goto(`${BASE}/quotes`)
    const row = page.locator('li.pleros-shop-list-card', { has: page.locator(`a[href="/quotes/${mainId}"]`) })
    await row.getByRole('link', { name: /^Edit/ }).click()
    await editDialog(page).waitFor()
    check('D. list Edit opens the edit dialog', await editDialog(page).isVisible())
    check('D. ?action=edit removed from the URL once opened', !new URL(page.url()).searchParams.has('action'), page.url())
    await expect(editDialog(page).getByLabel('Notes')).toHaveValue('Initial request for Q4 supplies')
    await shot(page, '04-edit-dialog')

    // "No changes" is caught before sending.
    let patches = 0
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && r.url().includes(`/quotes/${mainId}`)) patches++
    })
    await editDialog(page).getByRole('button', { name: 'Save changes' }).click()
    await expect(editDialog(page).getByRole('alert')).toContainText('There are no changes to save')
    check('UI. "no changes" message, nothing sent', patches === 0)

    await editDialog(page).getByLabel('Notes').fill('Updated: deliver to dock 4')
    // Slow the PATCH down so the busy state is visible, then double-click Save.
    slow = { method: 'PATCH', path: `/quotes/${mainId}`, ms: 1200 }
    const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/quotes/${mainId}`))
    await editDialog(page).getByRole('button', { name: 'Save changes' }).dblclick()
    const savingBtn = editDialog(page).getByRole('button', { name: 'Saving…' })
    check('UI. Save shows "Saving…" while in flight', await savingBtn.isVisible().catch(() => false))
    check('UI. Save is disabled while in flight', await savingBtn.isDisabled().catch(() => false))
    check('UI. notes field disabled while saving', await editDialog(page).getByLabel('Notes').isDisabled().catch(() => false))
    await shot(page, '05-edit-saving')
    const res = await saved
    check('D. notes edit saved', res.status() === 200, `HTTP ${res.status()}`)
    slow = null
    await expect(editDialog(page)).toBeHidden()
    await page.waitForTimeout(500)
    check('UI. focus is not lost to the page body after saving', await page.evaluate(() => document.activeElement !== document.body))
    check('UI. double-click sent exactly one PATCH', patches === 1, `${patches} PATCH requests`)
    await expect(page.getByRole('status')).toContainText('Quote updated.')
    check('D. new notes shown', await page.locator('main p', { hasText: 'Updated: deliver to dock 4' }).isVisible())
    await shot(page, '06-after-notes-edit')
  })

  await test.step('E/F. edit product, quantity and price; persists after reload', async () => {
    await page.getByRole('button', { name: 'Edit quote' }).click()
    const d = editDialog(page)
    await d.waitFor()
    // Validation messages
    await d.getByLabel('Line 1 quantity').fill('0')
    await d.getByRole('button', { name: 'Save changes' }).click()
    await expect(d.getByRole('alert')).toContainText('quantity must be a whole number')
    check('UI. quantity 0 is refused with a message', true)
    await d.getByLabel('Line 1 quantity').fill('3')
    await d.getByLabel('Line 1 unit price').fill('1.23456')
    await d.getByRole('button', { name: 'Save changes' }).click()
    await expect(d.getByRole('alert')).toContainText('at most 4 decimal places')
    check('UI. 5-decimal price is refused with a message', true)
    await shot(page, '07-edit-validation')

    // Change the product of line 1 via the search, then quantity and price; add a second line.
    const product = d.getByLabel('Line 1 product')
    const search = page.waitForResponse((r) => r.url().includes('/api/v1/skus?search='))
    await product.fill('QT-PAD')
    await search
    await page.waitForTimeout(200)
    await product.fill(PAD)
    await d.getByLabel('Line 1 description').fill('Legal pads, yellow')
    await d.getByLabel('Line 1 quantity').fill('40')
    await d.getByLabel('Line 1 unit price').fill('19.10')
    await d.getByRole('button', { name: '+ Line' }).click()
    await d.getByLabel('Line 2 product').fill(INK)
    await d.getByLabel('Line 2 description').fill('Ink')
    await d.getByLabel('Line 2 quantity').fill('2')
    await d.getByLabel('Line 2 unit price').fill('31.25')
    await shot(page, '08-edit-lines')
    const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/quotes/${mainId}`))
    await d.getByRole('button', { name: 'Save changes' }).click()
    const res = await saved
    const sent = JSON.parse(res.request().postData() ?? '{}')
    check('E. lines edit saved', res.status() === 200, `HTTP ${res.status()} ${res.status() === 200 ? '' : await res.text()}`)
    check('E. price sent as typed decimal text', sent.lines?.[0]?.unitPrice === '19.10', JSON.stringify(sent.lines?.[0]))
    check('E. expectedVersion sent, no updatedAt', typeof sent.expectedVersion === 'number' && !('updatedAt' in sent))
    await expect(d).toBeHidden()
    await page.reload()
    await page.locator('main h1').first().waitFor()
    const rows = await linesTable(page)
    check(
      'F. product, quantity and price persist after reload',
      rows.length === 2 && rows[0][1] === PAD && rows[0][3] === '40' && rows[0][4] === '$19.10' && rows[1][1] === INK && rows[1][3] === '2',
      JSON.stringify(rows),
    )
    check('F. reload does not reopen the edit dialog', (await editDialog(page).count()) === 0)
    check('F. notes persist after reload', await page.locator('main p', { hasText: 'Updated: deliver to dock 4' }).isVisible())
    await shot(page, '09-after-reload')
  })

  await test.step('UI. unsaved-change warning and keyboard', async () => {
    await page.getByRole('button', { name: 'Edit quote' }).click()
    const d = editDialog(page)
    await d.waitFor()
    // Focus is inside the dialog and stays there while tabbing.
    let trapped = true
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab')
      trapped &&= await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))
    }
    check('UI. Tab keeps focus inside the edit dialog', trapped)
    // Escape on an untouched form just closes.
    await page.keyboard.press('Escape')
    await expect(d).toBeHidden()
    check('UI. Escape closes an untouched edit dialog', true)
    const editBtn = page.getByRole('button', { name: 'Edit quote' })
    await page.waitForTimeout(300)
    check(
      'UI. focus returns to Edit quote',
      await editBtn.evaluate((el) => el === document.activeElement),
      await page.evaluate(() => `${document.activeElement?.tagName}:${(document.activeElement?.textContent ?? '').slice(0, 30)}`),
    )
    // Keyboard open: Enter on the focused button.
    await editBtn.focus()
    await page.keyboard.press('Enter')
    await d.waitFor()
    check('UI. Enter on Edit quote opens the dialog', await d.isVisible())
    await d.getByLabel('Notes').fill('Unsaved draft text')
    await page.keyboard.press('Escape')
    await expect(d.getByText('Discard your unsaved changes?')).toBeVisible()
    check('UI. Escape with unsaved changes asks before discarding', await d.isVisible())
    await shot(page, '10-unsaved-warning')
    await d.getByRole('button', { name: 'Keep editing' }).click()
    check('UI. Keep editing keeps the draft', (await d.getByLabel('Notes').inputValue()) === 'Unsaved draft text')
    await d.getByRole('button', { name: 'Close' }).click()
    await expect(d.getByText('Discard your unsaved changes?')).toBeVisible()
    check('UI. Close button with unsaved changes asks too', true)
    await d.getByRole('button', { name: 'Discard changes' }).click()
    await expect(d).toBeHidden()
    check('UI. Discard closes without saving', !(await page.getByText('Unsaved draft text').isVisible()))
  })

  await test.step('G/H/I. submit for approval, edit the pending quote, back to OPEN', async () => {
    const submitted = page.waitForResponse((r) => r.url().includes(`/quotes/${mainId}/request-approval`))
    await page.getByRole('button', { name: 'Submit for approval' }).click()
    const r = await submitted
    check('G. submitted for approval', r.status() === 200, `HTTP ${r.status()}`)
    await expect(badge(page)).toContainText('PENDING APPROVAL')
    check('H. Edit still offered while pending', await page.getByRole('button', { name: 'Edit quote' }).isVisible())
    check('H. pending warning shown', await page.getByText('This quote is waiting for approval. Saving changes moves it back to Open').first().isVisible())
    await shot(page, '11-pending-approval')
    await page.getByRole('button', { name: 'Edit quote' }).click()
    const d = editDialog(page)
    await d.waitFor()
    check('H. warning repeated in the dialog', await d.getByRole('note').isVisible())
    await d.getByLabel('Line 2 quantity').fill('6')
    await shot(page, '12-edit-pending')
    const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/quotes/${mainId}`))
    await d.getByRole('button', { name: 'Save changes' }).click()
    check('H. pending quote edit saved', (await saved).status() === 200)
    await expect(badge(page)).toContainText('OPEN')
    check('I. quote back to OPEN', !(await badge(page).innerText()).includes('PENDING'))
    await expect(page.getByRole('status')).toContainText('moved back to Open')
    check('I. "moved back to Open" notice', true)
    check('I. Submit for approval offered again', await page.getByRole('button', { name: 'Submit for approval' }).isVisible())
    await shot(page, '13-back-to-open')
  })

  await test.step('P. counter-offer workflow on an eligible quote', async () => {
    await page.getByRole('button', { name: 'Propose counter-offer' }).click()
    const modal = page.locator('.pleros-card', { has: page.getByRole('heading', { name: 'Propose counter-offer' }) })
    await modal.waitFor()
    await modal.locator('input[type="number"]').nth(1).fill('18.5')
    await modal.getByPlaceholder('Notes (optional)').fill('Can you do 18.50?')
    const sent = page.waitForResponse((r) => r.url().endsWith(`/quotes/${mainId}/counter-offers`) && r.request().method() === 'POST')
    await modal.getByRole('button', { name: 'Submit counter' }).click()
    const res = await sent
    check('P. buyer counter-offer sent', res.status() === 201 || res.status() === 200, `HTTP ${res.status()}`)
    await expect(page.getByText('Your offer')).toBeVisible()
    check('P. no Accept on the buyer’s own offer', (await page.getByRole('button', { name: 'Accept counter' }).count()) === 0)
    const q = (await buyerApi(page, 'GET', `/quotes/${mainId}`)).body
    const staffOffer = await staff('POST', `/quotes/${mainId}/counter-offers`, {
      notes: 'We can do 18.90',
      lines: q.lines.map((l: { lineNo: number; qty: number }) => ({ lineNo: l.lineNo, qty: l.qty, unitPrice: l.lineNo === 1 ? 18.9 : 30 })),
    })
    check('P. staff counter-offer created (setup)', staffOffer.status === 201 || staffOffer.status === 200, `HTTP ${staffOffer.status}`)
    await page.reload()
    await page.getByText('Admin counter').waitFor()
    const accept = page.getByRole('button', { name: 'Accept counter' })
    check('P. Accept shown on the staff offer', (await accept.count()) === 1)
    await shot(page, '14-counter-offers')
    const acc = page.waitForResponse((r) => r.url().includes('/counter-offers/accept'))
    await accept.click()
    check('P. buyer accepts staff counter', (await acc).status() === 200)
    await page.waitForTimeout(600)
    const rows = await linesTable(page)
    check('P. accepted prices applied to the quote', rows[0]?.[4] === '$18.90', JSON.stringify(rows))
    await shot(page, '15-counter-accepted')
  })

  // ---------------- Concurrency (409) ----------------
  await test.step('Concurrency. stale edit is refused, reload shows the newer data', async () => {
    const quote = await apiQuote(page, 'Concurrency base notes')
    const second = await buyerSession(browser)
    await openQuote(page, quote.id)
    await page.getByRole('button', { name: 'Edit quote' }).click()
    const d = editDialog(page)
    await d.waitFor()
    await d.getByLabel('Notes').fill('Stale edit from tab 1')
    // Another session (the same buyer in a second browser) saves first.
    await openQuote(second.page, quote.id)
    await second.page.getByRole('button', { name: 'Edit quote' }).click()
    await editDialog(second.page).getByLabel('Notes').fill('Newer edit from tab 2')
    const s2 = second.page.waitForResponse((r) => r.request().method() === 'PATCH')
    await editDialog(second.page).getByRole('button', { name: 'Save changes' }).click()
    check('409. second session saved first', (await s2).status() === 200)
    // Tab 1 saves its stale draft.
    const s1 = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(quote.id))
    await d.getByRole('button', { name: 'Save changes' }).click()
    const r1 = await s1
    check('409. stale save answered 409', r1.status() === 409, `HTTP ${r1.status()}`)
    await expect(d.getByRole('alert')).toContainText('Reload to see the latest version')
    check('409. conflict message shown in the dialog', true)
    check('409. reload guidance given once (no "try again" repeat)', !(await d.getByRole('alert').innerText()).includes('try again'), await d.getByRole('alert').innerText())
    check('409. unsaved draft kept in the form', (await d.getByLabel('Notes').inputValue()) === 'Stale edit from tab 1')
    check('409. Reload latest version offered', await d.getByRole('button', { name: 'Reload latest version' }).isVisible())
    const stored = (await buyerApi(page, 'GET', `/quotes/${quote.id}`)).body
    check('409. stale edit did not overwrite newer data', stored.notes === 'Newer edit from tab 2', String(stored.notes))
    await shot(page, '16-conflict-409')
    await d.getByRole('button', { name: 'Reload latest version' }).click()
    await expect(d.getByLabel('Notes')).toHaveValue('Newer edit from tab 2')
    check('409. reload restarts the edit from the latest version', true)
    check('409. conflict message cleared after reload', (await d.getByRole('alert').count()) === 0)
    await shot(page, '17-after-conflict-reload')
    await d.getByRole('button', { name: 'Cancel' }).click()
    await expect(d).toBeHidden()

    // Withdraw with a stale version.
    await page.getByRole('button', { name: 'Withdraw quote' }).click()
    await withdrawDialog(page).waitFor()
    await second.page.reload()
    await second.page.getByRole('button', { name: 'Edit quote' }).click()
    await editDialog(second.page).getByLabel('Notes').fill('Second change from tab 2')
    const s3 = second.page.waitForResponse((r) => r.request().method() === 'PATCH')
    await editDialog(second.page).getByRole('button', { name: 'Save changes' }).click()
    await s3
    const w = page.waitForResponse((r) => r.url().endsWith(`/quotes/${quote.id}/withdraw`))
    await withdrawDialog(page).getByRole('button', { name: 'Withdraw quote' }).click()
    check('409. stale withdraw answered 409', (await w).status() === 409)
    await expect(withdrawDialog(page).getByRole('alert')).toContainText('Reload')
    check('409. withdraw conflict shown', true)
    const still = (await buyerApi(page, 'GET', `/quotes/${quote.id}`)).body
    check('409. stale withdraw left the quote OPEN', still.status === 'OPEN')
    await shot(page, '18-withdraw-conflict-409')
    await withdrawDialog(page).getByRole('button', { name: 'Reload latest version' }).click()
    await expect(withdrawDialog(page)).toBeHidden()
    await expect(page.locator('main p', { hasText: 'Second change from tab 2' })).toBeVisible()
    check('409. reload shows newest notes', true)
    await second.context.close()
  })

  // ---------------- J/K/L: withdrawal ----------------
  await test.step('J/K/L. withdraw an eligible quote', async () => {
    const quote = await apiQuote(page, 'To be withdrawn')
    await page.goto(`${BASE}/quotes`)
    const row = page.locator('li.pleros-shop-list-card', { has: page.locator(`a[href="/quotes/${quote.id}"]`) })
    await row.getByRole('link', { name: /^Withdraw/ }).click()
    const d = withdrawDialog(page)
    await d.waitFor()
    check('J. list Withdraw opens the confirmation', await d.isVisible())
    check('J. confirmation explains it is not deleted', await d.getByText('It is not deleted').isVisible())
    await shot(page, '19-withdraw-confirm')
    // Cancel sends nothing.
    let posts = 0
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith(`/quotes/${quote.id}/withdraw`)) posts++
    })
    await d.getByRole('button', { name: 'Cancel' }).click()
    await expect(d).toBeHidden()
    check('J. Cancel sends nothing and keeps the quote open', posts === 0 && (await badge(page).innerText()).includes('OPEN'))
    // Keyboard: Escape closes.
    await page.getByRole('button', { name: 'Withdraw quote' }).click()
    await d.waitFor()
    await page.keyboard.press('Escape')
    await expect(d).toBeHidden()
    check('UI. Escape closes the withdraw confirmation', posts === 0)
    await page.getByRole('button', { name: 'Withdraw quote' }).click()
    await d.getByLabel('Reason (optional)').fill('Found a closer supplier')
    slow = { method: 'POST', path: `/quotes/${quote.id}/withdraw`, ms: 1000 }
    const res = page.waitForResponse((r) => r.url().endsWith(`/quotes/${quote.id}/withdraw`))
    await d.getByRole('button', { name: 'Withdraw quote' }).dblclick()
    check('UI. Withdraw shows "Withdrawing…" while in flight', await d.getByRole('button', { name: 'Withdrawing…' }).isDisabled().catch(() => false))
    const wr = await res
    check('J. withdrawn', wr.status() === 200, `HTTP ${wr.status()}`)
    const sent = JSON.parse(wr.request().postData() ?? '{}')
    check('J. withdraw body has expectedVersion and the reason', typeof sent.expectedVersion === 'number' && sent.withdrawReason === 'Found a closer supplier')
    await expect(d).toBeHidden()
    await page.waitForTimeout(500)
    check('UI. double-click sent exactly one withdraw', posts === 1, `${posts} POSTs`)
    slow = null
    await expect(badge(page)).toContainText('WITHDRAWN')
    check('K. WITHDRAWN badge', true)
    check('K. withdrawal date and reason shown', await page.getByText(/Withdrawn on .*: Found a closer supplier/).isVisible())
    check('K. locked explanation shown', await page.getByText('You withdrew this quote.').isVisible())
    check('K. withdrawn notice', (await page.getByRole('status').innerText()).includes('Quote withdrawn'))
    check('UI. focus moves to the quote heading after withdrawal', await page.evaluate(() => document.activeElement?.tagName === 'H1'))
    await shot(page, '20-withdrawn-detail')
    check('L. no Edit quote after withdrawal', (await page.getByRole('button', { name: 'Edit quote' }).count()) === 0)
    check('L. no Withdraw quote after withdrawal', (await page.getByRole('button', { name: 'Withdraw quote' }).count()) === 0)
    check('L. no Submit / counter-offer after withdrawal', (await page.getByRole('button', { name: /Submit for approval|Propose counter-offer/ }).count()) === 0)
    await page.reload()
    await expect(badge(page)).toContainText('WITHDRAWN')
    check('K. still withdrawn after reload', (await page.getByRole('button', { name: 'Edit quote' }).count()) === 0)
    // ?action=withdraw on a withdrawn quote opens nothing.
    await openQuote(page, quote.id, '?action=edit')
    await page.waitForTimeout(500)
    check('L. ?action=edit on a withdrawn quote opens nothing', (await editDialog(page).count()) === 0)
    await page.goto(`${BASE}/quotes`)
    const wrow = page.locator('li.pleros-shop-list-card', { has: page.locator(`a[href="/quotes/${quote.id}"]`) })
    await wrow.waitFor()
    check('L. list: withdrawn quote kept, no Edit / Withdraw', (await wrow.getByRole('link', { name: /^(Edit|Withdraw)/ }).count()) === 0)
    check('K. list shows WITHDRAWN', (await wrow.innerText()).includes('WITHDRAWN'))
    await shot(page, '21-list-withdrawn')
  })

  // ---------------- M: staff-created ----------------
  await test.step('M. staff-created quote has no buyer actions', async () => {
    const s = await staff('POST', '/quotes', { customerRef: ids.customerId, notes: 'Prepared by our sales desk', lines: LINES })
    check('M. staff quote created (setup)', s.status === 201, `HTTP ${s.status}`)
    await page.goto(`${BASE}/quotes`)
    const row = page.locator('li.pleros-shop-list-card', { has: page.locator(`a[href="/quotes/${s.body.id}"]`) })
    await row.waitFor()
    check('M. staff quote visible to the buyer', await row.isVisible())
    check('M. list: no Edit / Withdraw on the staff quote', (await row.getByRole('link', { name: /^(Edit|Withdraw)/ }).count()) === 0)
    await shot(page, '22-list-staff-quote')
    await openQuote(page, s.body.id, '?action=edit')
    await page.waitForTimeout(500)
    check('M. detail: no Edit quote', (await page.getByRole('button', { name: 'Edit quote' }).count()) === 0)
    check('M. detail: no Withdraw quote', (await page.getByRole('button', { name: 'Withdraw quote' }).count()) === 0)
    check('M. ?action=edit opens nothing', (await editDialog(page).count()) === 0)
    const b = (await buyerApi(page, 'GET', `/quotes/${s.body.id}`)).body
    check('M. server flags false; no creator / approver ids', b.canEdit === false && b.canWithdraw === false && !('createdByUserId' in b) && !('approvedByUserId' in b))
    // Direct request is refused by the server even if a client tried.
    const forced = await buyerApi(page, 'PATCH', `/quotes/${s.body.id}`, { expectedVersion: b.version, notes: 'x' })
    check('M. server refuses a forced edit (403)', forced.status === 403, `HTTP ${forced.status}`)
    await shot(page, '23-detail-staff-quote')
  })

  // ---------------- N: approved ----------------
  await test.step('N. approved quote is frozen', async () => {
    const quote = await apiQuote(page, 'Will be approved')
    const qd = (await buyerApi(page, 'GET', `/quotes/${quote.id}`)).body
    const offer = await staff('POST', `/quotes/${quote.id}/counter-offers`, {
      lines: qd.lines.map((l: { lineNo: number; qty: number }) => ({ lineNo: l.lineNo, qty: l.qty, unitPrice: 15 })),
    })
    check('N. open staff counter-offer before approval (setup)', offer.status === 201 || offer.status === 200, `HTTP ${offer.status}`)
    check('N. request approval (setup)', (await buyerApi(page, 'POST', `/quotes/${quote.id}/request-approval`, {})).status === 200)
    const ap = await staff('POST', `/quotes/${quote.id}/approve`)
    check('N. staff approves (setup)', ap.status === 200, `HTTP ${ap.status}`)
    await openQuote(page, quote.id, '?action=withdraw')
    await page.waitForTimeout(500)
    await expect(badge(page)).toContainText('APPROVED')
    check('N. no Edit quote', (await page.getByRole('button', { name: 'Edit quote' }).count()) === 0)
    check('N. no Withdraw quote', (await page.getByRole('button', { name: 'Withdraw quote' }).count()) === 0)
    check('N. no Propose counter-offer', (await page.getByRole('button', { name: 'Propose counter-offer' }).count()) === 0)
    check('N. no Accept counter', (await page.getByRole('button', { name: 'Accept counter' }).count()) === 0)
    check('N. ?action=withdraw opens nothing', (await withdrawDialog(page).count()) === 0)
    check('N. approved explanation shown', await page.getByText('This quote is approved, so its terms are final').isVisible())
    check('N. Place order still offered', await page.getByRole('button', { name: 'Place order' }).isVisible())
    check('N. earlier open offer shown as superseded', (await page.locator('.pleros-card', { hasText: 'Counter-offers' }).innerText()).includes('SUPERSEDED'))
    await shot(page, '24-approved-frozen')
    await page.goto(`${BASE}/quotes`)
    const row = page.locator('li.pleros-shop-list-card', { has: page.locator(`a[href="/quotes/${quote.id}"]`) })
    check('N. list: no Edit / Withdraw on the approved quote', (await row.getByRole('link', { name: /^(Edit|Withdraw)/ }).count()) === 0)
  })

  // ---------------- Phase 8 additions: rejected edit, legacy / expired, buyer order, direct-API probes ----------------
  await test.step('R. a rejected quote can be edited and goes back to Open', async () => {
    const quote = await apiQuote(page, 'Will be rejected')
    check('R. request approval (setup)', (await buyerApi(page, 'POST', `/quotes/${quote.id}/request-approval`, {})).status === 200)
    const rj = await staff('POST', `/quotes/${quote.id}/reject`, { reason: 'QTEST: please adjust quantities' })
    check('R. staff rejects (setup)', rj.status === 200, `HTTP ${rj.status}`)
    await openQuote(page, quote.id)
    await expect(badge(page)).toContainText('REJECTED')
    check('R. Edit offered on the rejected quote', await page.getByRole('button', { name: 'Edit quote' }).isVisible())
    check('R. rejected warning shown', await page.getByText('Saving changes moves this quote back to Open').first().isVisible())
    await page.getByRole('button', { name: 'Edit quote' }).click()
    const d = editDialog(page)
    await d.waitFor()
    await d.getByLabel('Line 1 quantity').fill('12')
    const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/quotes/${quote.id}`))
    await d.getByRole('button', { name: 'Save changes' }).click()
    check('R. rejected quote edit saved', (await saved).status() === 200)
    await expect(badge(page)).toContainText('OPEN')
    check('R. Submit for approval offered again', await page.getByRole('button', { name: 'Submit for approval' }).isVisible())
    await shot(page, '29-rejected-edited-back-to-open')
  })

  await test.step('X. legacy and expired quotes have no buyer actions', async () => {
    const fx = JSON.parse(fs.readFileSync(path.join(TMP, 'fixture-ids.json'), 'utf8')) as { legacyQuoteId: string; expiredQuoteId: string }
    for (const [label, id] of [['legacy', fx.legacyQuoteId], ['expired', fx.expiredQuoteId]] as const) {
      await openQuote(page, id, '?action=edit')
      await page.waitForTimeout(500)
      check(`X. ${label}: no Edit / Withdraw`, (await page.getByRole('button', { name: /^(Edit quote|Withdraw quote)$/ }).count()) === 0)
      check(`X. ${label}: ?action=edit opens nothing`, (await editDialog(page).count()) === 0)
      const b = (await buyerApi(page, 'GET', `/quotes/${id}`)).body
      check(`X. ${label}: server flags false`, b.canEdit === false && b.canWithdraw === false)
      const forced = await buyerApi(page, 'PATCH', `/quotes/${id}`, { expectedVersion: b.version, notes: 'x' })
      const forcedW = await buyerApi(page, 'POST', `/quotes/${id}/withdraw`, { expectedVersion: b.version })
      check(`X. ${label}: forced edit / withdraw refused`, forced.status >= 400 && forced.status < 500 && forcedW.status >= 400 && forcedW.status < 500, `${forced.status}/${forcedW.status}`)
    }
    check('X. expired explanation shown', await page.getByText('This quote has expired').isVisible())
    await shot(page, '30-expired-no-actions')
  })

  await test.step('Q. buyer places the order from an approved quote; direct API probes', async () => {
    const quote = await apiQuote(page, 'Will be ordered')
    // Impersonation: the body's offeredBy / userId are ignored; the side comes from the session.
    const offer = await buyerApi(page, 'POST', `/quotes/${quote.id}/counter-offers`, {
      offeredBy: 'ADMIN',
      userId: 'someone-else',
      lines: LINES.map((l) => ({ lineNo: l.lineNo, qty: l.qty, unitPrice: '18' })),
    })
    check('Q. buyer offer stored as BUYER whatever the body says', offer.status === 201 && offer.body.offeredBy === 'BUYER' && offer.body.side === 'BUYER', JSON.stringify({ s: offer.status, by: offer.body?.offeredBy, side: offer.body?.side }))
    const own = await buyerApi(page, 'POST', `/quotes/${quote.id}/counter-offers/accept`, { counterOfferId: offer.body.id })
    check('Q. buyer cannot accept their own offer (403)', own.status === 403, `HTTP ${own.status}`)
    const offersSeen = (await buyerApi(page, 'GET', `/quotes/${quote.id}/counter-offers`)).body as Array<Record<string, unknown>>
    check('Q. buyer offer list carries no internal user ids', offersSeen.every((o) => !('userId' in o) && !('acceptedByUserId' in o)))
    const qd = (await buyerApi(page, 'GET', `/quotes/${quote.id}`)).body
    const prot = await buyerApi(page, 'PATCH', `/quotes/${quote.id}`, { expectedVersion: qd.version, status: 'APPROVED' })
    check('Q. protected field in an edit refused (400)', prot.status === 400, `HTTP ${prot.status}`)
    check('Q. request approval (setup)', (await buyerApi(page, 'POST', `/quotes/${quote.id}/request-approval`, {})).status === 200)
    const selfApprove = await buyerApi(page, 'POST', `/quotes/${quote.id}/approve`, {})
    check('Q. buyer cannot approve their own quote (403)', selfApprove.status === 403, `HTTP ${selfApprove.status}`)
    check('Q. staff approves (setup)', (await staff('POST', `/quotes/${quote.id}/approve`)).status === 200)

    await openQuote(page, quote.id)
    const placed = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/quotes/${quote.id}/submit`))
    await page.getByRole('button', { name: 'Place order' }).click()
    const pr = await placed
    check('Q. Place order succeeds', pr.status() === 200, `HTTP ${pr.status()}`)
    await expect(badge(page)).toContainText('SUBMITTED')
    check('Q. order placed: explanation shown, no Place order / Edit / Withdraw / Propose', (await page.getByText('An order was placed from this quote').isVisible()) &&
      (await page.getByRole('button', { name: /^(Place order|Edit quote|Withdraw quote|Propose counter-offer)$/ }).count()) === 0)
    await shot(page, '31-order-placed')
    const after = (await buyerApi(page, 'GET', `/quotes/${quote.id}`)).body
    const again = await buyerApi(page, 'POST', `/quotes/${quote.id}/submit`, {})
    check('Q. repeating the order request returns the same order', again.status === 200 && !!after.convertedOrderId && again.body.convertedOrderId === after.convertedOrderId)
    const staffOrders = await staff('GET', `/orders?page=1&pageSize=100`)
    const list = (Array.isArray(staffOrders.body) ? staffOrders.body : staffOrders.body?.items ?? staffOrders.body?.data ?? []) as Array<{ sourceQuoteId?: string }>
    check('Q. exactly one order exists for the quote', list.filter((o) => o.sourceQuoteId === quote.id).length === 1, `${list.length} orders listed`)
    const editAfter = await buyerApi(page, 'PATCH', `/quotes/${quote.id}`, { expectedVersion: after.version, notes: 'x' })
    const counterAfter = await buyerApi(page, 'POST', `/quotes/${quote.id}/counter-offers`, { lines: [{ lineNo: 1, qty: 1, unitPrice: '1' }] })
    check('Q. no edit or counter-offer after conversion (400)', editAfter.status === 400 && counterAfter.status === 400, `${editAfter.status}/${counterAfter.status}`)
  })

  // ---------------- Responsive ----------------
  await test.step('UI. responsive layouts (375 / 768)', async () => {
    for (const [label, vp, mobile] of [
      ['phone-375', { width: 375, height: 812 }, true],
      ['tablet-768', { width: 768, height: 1024 }, false],
    ] as const) {
      const s = await buyerSession(browser, vp, mobile)
      await s.page.goto(`${BASE}/quotes`)
      await s.page.locator('li.pleros-shop-list-card').first().waitFor()
      let o = await overflow(s.page)
      check(`UI ${label}. quote list has no sideways overflow`, !o.doc && o.wide.length === 0, JSON.stringify(o))
      await shot(s.page, `25-${label}-list`, true)
      await openQuote(s.page, mainId)
      o = await overflow(s.page)
      check(`UI ${label}. quote detail has no sideways overflow`, !o.doc && o.wide.length === 0, JSON.stringify(o))
      await shot(s.page, `26-${label}-detail`, true)
      await s.page.getByRole('button', { name: 'Edit quote' }).click()
      await editDialog(s.page).waitFor()
      o = await overflow(s.page)
      const box = await editDialog(s.page).boundingBox()
      check(`UI ${label}. edit dialog fits the screen`, !!box && box.x >= 0 && box.x + box.width <= vp.width + 1 && o.wide.length === 0, JSON.stringify({ box, o }))
      const save = editDialog(s.page).getByRole('button', { name: 'Save changes' })
      check(`UI ${label}. Save reachable in the dialog`, await save.isVisible() && (await save.boundingBox())!.y + 10 < vp.height)
      await shot(s.page, `27-${label}-edit-dialog`)
      await editDialog(s.page).getByRole('button', { name: 'Cancel' }).click()
      await s.page.getByRole('button', { name: 'Withdraw quote' }).click()
      await withdrawDialog(s.page).waitFor()
      const wbox = await withdrawDialog(s.page).boundingBox()
      check(`UI ${label}. withdraw dialog fits the screen`, !!wbox && wbox.x >= 0 && wbox.x + wbox.width <= vp.width + 1, JSON.stringify(wbox))
      await shot(s.page, `28-${label}-withdraw-dialog`)
      await s.context.close()
    }
  })

  check('no request left the local server', blocked.size === 0, [...blocked].join(', '))
  await context.close()
})

test.afterAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true })
  fs.writeFileSync(path.join(SHOTS, 'ui-results.json'), JSON.stringify({ results, blocked: [...blocked], httpErrors, consoleErrors }, null, 2))
  const failed = results.filter((r) => !r.ok)
  console.log(`[qtest] ${results.length - failed.length}/${results.length} checks passed`)
  for (const f of failed) console.log(`[qtest] FAILED: ${f.name} — ${f.detail}`)
  if (consoleErrors.length) console.log(`[qtest] browser console errors: ${consoleErrors.length} (see ui-results.json)`)
})
