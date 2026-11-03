import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { loginAdmin } from './helpers/auth'
import type { RequisitionFixture, TenantSnapshot } from './fixtures/requisition-fixture'

// Controls around purchase requisitions: rejection/revision, withdrawal, cancellation, permissions, tenant isolation,
// validation, duplicate actions and stale pages, and the closed direct-PO path.
//
// Layers: "[browser]" tests drive the real UI in Chromium (with API calls for setup and for checks the UI cannot
// show); "[api]" tests call the HTTP API of the running server. Every refused action is bracketed by database
// snapshots (fixtures/requisition-fixture.ts snapshot) that must be equal, and paired with an authorized success.
//
// Logins are rate limited (20 per IP, 10 per email, per 5 minutes), so each person signs in once through the login
// page and the session is reused.

const webDir = path.resolve(__dirname, '../apps/web')
const fixtureScript = path.resolve(__dirname, 'fixtures/requisition-fixture.ts')

function fixture(...args: string[]): string {
  const out = execFileSync(process.execPath, ['--import', './server/register-paths.mjs', '--import', 'tsx', fixtureScript, ...args], {
    cwd: webDir,
    encoding: 'utf8',
    env: process.env,
  })
  return out.trim().split('\n').pop() ?? ''
}

type Who = 'requester' | 'approver' | 'admin' | 'rep' | 'other'
type Session = { state: Awaited<ReturnType<BrowserContext['storageState']>>; token: string }

let fx: RequisitionFixture
let apiCtx: APIRequestContext
const sessions = {} as Record<Who, Session>
const contexts: BrowserContext[] = []
let supplierA = ''
let supplierB = ''

const emailOf = (who: Who) => (who === 'other' ? fx.other!.users.manager : (fx.users[who] as string))

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  test.setTimeout(180_000)
  fx = JSON.parse(fixture('create', '--second-tenant')) as RequisitionFixture
  apiCtx = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL })
  for (const who of ['requester', 'approver', 'admin', 'rep', 'other'] as Who[]) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await loginAdmin(page, emailOf(who), fx.password)
    const state = await ctx.storageState()
    const token = state.origins.flatMap((o) => o.localStorage).find((e) => e.name === 'pleros.admin.accessToken')?.value
    if (!token) throw new Error(`no access token stored for ${who}`)
    sessions[who] = { state, token }
    await ctx.close()
  }
  supplierA = ((await api('requester', 'GET', '/suppliers')).body as Array<{ id: string }>)[0].id
  supplierB = ((await api('other', 'GET', '/suppliers')).body as Array<{ id: string }>)[0].id
})

test.afterAll(async () => {
  for (const c of contexts) await c.close().catch(() => undefined)
  await apiCtx?.dispose()
  if (fx) fixture('cleanup', fx.tenantId, ...(fx.other ? [fx.other.tenantId] : []))
})

test.describe.configure({ timeout: 180_000 })

// ---------------------------------------------------------------- helpers

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(who: Who, method: string, p: string, data?: unknown): Promise<{ status: number; body: any }> {
  const res = await apiCtx.fetch(`/api/v1${p}`, {
    method,
    headers: { authorization: `Bearer ${sessions[who].token}`, ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(data === undefined ? {} : { data }),
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* no body */
  }
  return { status: res.status(), body }
}

async function open(browser: Browser, who: Who, url: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: sessions[who].state })
  contexts.push(ctx)
  const page = await ctx.newPage()
  await page.goto(url)
  return page
}

async function shot(page: Page, name: string) {
  const file = test.info().outputPath(`${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  await test.info().attach(name, { path: file, contentType: 'image/png' })
}

function snap(tenantId = fx.tenantId): TenantSnapshot {
  return (JSON.parse(fixture('snapshot', tenantId)) as Record<string, TenantSnapshot>)[tenantId]
}

const badge = (page: Page, text: string) => page.getByText(text, { exact: true }).first()
const reqUrl = (id: string) => `/admin/purchasing/requisitions/${id}`
const line = (over: Record<string, unknown> = {}) => ({ description: 'Widget', qtyRequested: 50, unitCost: '4.2525', ...over })

async function draft(over: Record<string, unknown> = {}) {
  const r = await api('requester', 'POST', '/purchase-requisitions', { supplierId: supplierA, freightAmount: '12.50', lines: [line()], ...over })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body as { id: string; number: string }
}
async function submitted(over: Record<string, unknown> = {}) {
  const d = await draft(over)
  const s = await api('requester', 'POST', `/purchase-requisitions/${d.id}/submit`)
  expect(s.status, JSON.stringify(s.body)).toBe(200)
  return s.body as { id: string; number: string; approvalRequestId: string }
}
async function approved(over: Record<string, unknown> = {}) {
  const s = await submitted(over)
  const a = await api('approver', 'POST', `/approvals/${s.approvalRequestId}/decide`, { approve: true })
  expect(a.status, JSON.stringify(a.body)).toBe(200)
  return s
}

// ---------------------------------------------------------------- 1. rejection and revision

test('[browser] rejection and revision: reason shown, conversion blocked, Revision 2, fresh approval converts the revised details', async ({ browser }) => {
  const d = await draft({ freightAmount: '0' })
  const rita = await open(browser, 'requester', reqUrl(d.id))
  await rita.getByRole('button', { name: 'Submit for approval' }).click()
  await expect(badge(rita, 'PENDING APPROVAL')).toBeVisible()
  const firstApproval = (await api('requester', 'GET', `/purchase-requisitions/${d.id}`)).body.approvalRequestId as string

  const alex = await open(browser, 'approver', reqUrl(d.id))
  await alex.getByRole('button', { name: 'Reject' }).click()
  const confirm = alex.getByRole('region', { name: 'Reject this requisition?' }).getByRole('button', { name: 'Reject' })
  await expect(confirm).toBeDisabled()
  await alex.getByLabel('Reason (required)').fill('Order 40, not 50')
  await confirm.click()
  await expect(badge(alex, 'REJECTED')).toBeVisible()
  await expect(alex.getByRole('button', { name: 'Convert to PO' })).toHaveCount(0)

  await rita.reload()
  await expect(rita.getByText('“Order 40, not 50”')).toBeVisible()
  await shot(rita, 'rejected-reason-visible')

  const before = snap()
  const blocked = await api('approver', 'POST', `/purchase-requisitions/${d.id}/convert`, {})
  expect(blocked.status).toBe(409)
  expect(snap()).toEqual(before)

  await rita.getByRole('button', { name: 'Edit' }).click()
  await rita.getByLabel('Quantity').fill('40')
  await rita.getByRole('button', { name: 'Save changes' }).click()
  await expect(rita.getByRole('cell', { name: '40', exact: true })).toBeVisible()
  await rita.getByRole('button', { name: 'Resubmit for approval' }).click()
  await expect(rita.getByText('Revision 2')).toBeVisible()

  // The decided approval of revision 1 cannot be reused for revision 2.
  const beforeStale = snap()
  const stale = await api('approver', 'POST', `/approvals/${firstApproval}/decide`, { approve: true })
  expect(stale.status).toBe(400)
  expect(snap()).toEqual(beforeStale)

  await alex.reload()
  await alex.getByRole('button', { name: 'Approve' }).click()
  await expect(badge(alex, 'APPROVED')).toBeVisible()
  await alex.getByRole('button', { name: 'Convert to PO' }).click()
  await alex.getByRole('button', { name: 'Create PO' }).click()
  await alex.waitForURL(/\/admin\/purchasing\/(?!requisitions)[^/]+$/)
  await expect(alex.getByRole('cell', { name: '$4.2525' })).toBeVisible()
  await expect(alex.getByRole('cell', { name: '$170.10' })).toBeVisible() // 40 x 4.2525: the revised quantity
  await shot(alex, 'revised-requisition-converted')
})

// ---------------------------------------------------------------- 2. withdrawal

test('[browser] withdrawing a pending requisition returns it to DRAFT and its approval request can no longer authorize anything', async ({ browser }) => {
  const s = await submitted()
  const rita = await open(browser, 'requester', reqUrl(s.id))
  await rita.getByRole('button', { name: 'Withdraw for revision' }).click()
  await rita.getByRole('region', { name: 'Withdraw for revision?' }).getByRole('button', { name: 'Withdraw' }).click()
  await expect(badge(rita, 'DRAFT')).toBeVisible()
  await rita.reload()
  await expect(badge(rita, 'DRAFT')).toBeVisible()

  const before = snap()
  expect(before.approvalRequests[s.approvalRequestId]).toBe('CANCELLED')
  const decide = await api('approver', 'POST', `/approvals/${s.approvalRequestId}/decide`, { approve: true })
  expect(decide.status).toBe(400)
  expect(decide.body.message).toMatch(/cancelled/)
  expect((await api('approver', 'POST', `/purchase-requisitions/${s.id}/convert`, {})).status).toBe(409)
  expect(snap()).toEqual(before)
})

test('[browser] withdrawing an approved requisition blocks conversion until it is resubmitted and approved again', async ({ browser }) => {
  const s = await approved()
  const rita = await open(browser, 'requester', reqUrl(s.id))
  await expect(badge(rita, 'APPROVED')).toBeVisible()
  await rita.getByRole('button', { name: 'Withdraw for revision' }).click()
  await expect(rita.getByText(/throws away the approval/)).toBeVisible()
  await rita.getByRole('region', { name: 'Withdraw for revision?' }).getByRole('button', { name: 'Withdraw' }).click()
  await expect(badge(rita, 'DRAFT')).toBeVisible()

  const before = snap()
  expect(before.approvalRequests[s.approvalRequestId]).toBe('APPROVED') // the decision stays on record but no longer counts
  expect((await api('approver', 'POST', `/purchase-requisitions/${s.id}/convert`, {})).status).toBe(409)
  expect(snap()).toEqual(before)

  const again = await api('requester', 'POST', `/purchase-requisitions/${s.id}/submit`)
  expect(again.body.revision).toBe(2)
  const beforePending = snap()
  expect((await api('approver', 'POST', `/purchase-requisitions/${s.id}/convert`, {})).status).toBe(409)
  expect(snap()).toEqual(beforePending)

  expect((await api('approver', 'POST', `/approvals/${again.body.approvalRequestId}/decide`, { approve: true })).status).toBe(200)
  const converted = await api('approver', 'POST', `/purchase-requisitions/${s.id}/convert`, {})
  expect(converted.status).toBe(201)
  expect(snap().purchaseOrders).toBe(before.purchaseOrders + 1)
})

// ---------------------------------------------------------------- 3. cancellation

for (const from of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] as const) {
  test(`[browser] cancel from ${from}: final after refresh, every later action refused, pending approval closed`, async ({ browser }) => {
    const r = from === 'DRAFT' ? await draft() : from === 'PENDING_APPROVAL' ? await submitted() : await approved()
    const approvalId = (await api('requester', 'GET', `/purchase-requisitions/${r.id}`)).body.approvalRequestId as string | null
    const rita = await open(browser, 'requester', reqUrl(r.id))
    await rita.getByRole('button', { name: 'Cancel requisition' }).click()
    await rita.getByLabel('Reason (optional)').fill(`No longer needed (${from})`)
    await rita.getByRole('region', { name: 'Cancel this requisition?' }).getByRole('button', { name: 'Cancel requisition' }).click()
    await expect(badge(rita, 'CANCELLED')).toBeVisible()
    await rita.reload()
    await expect(badge(rita, 'CANCELLED')).toBeVisible()
    // Exact: the reason also appears inside the closed approval request's "Requisition cancelled: …" note.
    await expect(rita.getByText(`No longer needed (${from})`, { exact: true })).toBeVisible()
    for (const name of ['Edit', 'Submit for approval', 'Withdraw for revision', 'Cancel requisition', 'Convert to PO', 'Approve']) {
      await expect(rita.getByRole('button', { name })).toHaveCount(0)
    }
    const alex = await open(browser, 'approver', reqUrl(r.id))
    await expect(badge(alex, 'CANCELLED')).toBeVisible()
    for (const name of ['Approve', 'Reject', 'Convert to PO']) await expect(alex.getByRole('button', { name })).toHaveCount(0)
    await shot(rita, `cancelled-from-${from.toLowerCase()}`)

    const before = snap()
    if (from === 'PENDING_APPROVAL') expect(before.approvalRequests[approvalId as string]).toBe('CANCELLED')
    if (from === 'APPROVED') expect(before.approvalRequests[approvalId as string]).toBe('APPROVED')
    expect((await api('requester', 'PATCH', `/purchase-requisitions/${r.id}`, { notes: 'x' })).status).toBe(409)
    expect((await api('requester', 'POST', `/purchase-requisitions/${r.id}/submit`)).status).toBe(409)
    expect((await api('requester', 'POST', `/purchase-requisitions/${r.id}/withdraw`)).status).toBe(409)
    expect((await api('approver', 'POST', `/purchase-requisitions/${r.id}/convert`, {})).status).toBe(409)
    if (approvalId) expect((await api('approver', 'POST', `/approvals/${approvalId}/decide`, { approve: true })).status).toBe(400)
    expect(snap()).toEqual(before)
  })
}

// ---------------------------------------------------------------- 4. permissions

test('[browser] sales rep is denied through navigation, direct URLs and the API; nothing changes', async ({ browser }) => {
  const s = await submitted()
  const d = await draft()
  const sam = await open(browser, 'rep', '/admin')
  await expect(sam.getByRole('navigation', { name: 'Admin navigation' })).toBeVisible()
  await expect(sam.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Requisitions' })).toHaveCount(0)
  await sam.goto('/admin/purchasing/requisitions')
  await expect(sam.getByText(/You don't have access to requisitions/)).toBeVisible()
  await expect(sam.getByRole('link', { name: 'New requisition' })).toHaveCount(0)
  await sam.goto(reqUrl(s.id))
  await expect(sam.getByText("You don't have access to requisitions")).toBeVisible()
  await sam.goto('/admin/purchasing/requisitions/new')
  await expect(sam.getByText(/can't raise requisitions/)).toBeVisible()
  await shot(sam, 'rep-denied-new-requisition')

  const before = snap()
  const denied = [
    await api('rep', 'GET', '/purchase-requisitions'),
    await api('rep', 'GET', `/purchase-requisitions/${s.id}`),
    await api('rep', 'POST', '/purchase-requisitions', { supplierId: supplierA, lines: [line()] }),
    await api('rep', 'PATCH', `/purchase-requisitions/${d.id}`, { notes: 'rep was here' }),
    await api('rep', 'POST', `/purchase-requisitions/${d.id}/submit`),
    await api('rep', 'POST', `/purchase-requisitions/${s.id}/withdraw`),
    await api('rep', 'POST', `/purchase-requisitions/${s.id}/cancel`, {}),
    await api('rep', 'POST', `/purchase-requisitions/${s.id}/convert`, {}),
    await api('rep', 'POST', `/approvals/${s.approvalRequestId}/decide`, { approve: true }),
  ]
  expect(denied.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403, 403, 403])
  expect(snap()).toEqual(before)

  // Paired authorized successes.
  expect((await api('requester', 'GET', `/purchase-requisitions/${s.id}`)).status).toBe(200)
  expect((await api('approver', 'POST', `/approvals/${s.approvalRequestId}/decide`, { approve: true })).status).toBe(200)
  expect((await api('approver', 'POST', `/purchase-requisitions/${s.id}/convert`, {})).status).toBe(201)
})

test('[api] the requester cannot approve their own requisition; a different manager can', async () => {
  const s = await submitted()
  const before = snap()
  const self = await api('requester', 'POST', `/approvals/${s.approvalRequestId}/decide`, { approve: true })
  expect(self.status).toBe(403)
  expect(self.body.message).toMatch(/own request/)
  expect(snap()).toEqual(before)
  const other = await api('approver', 'POST', `/approvals/${s.approvalRequestId}/decide`, { approve: true })
  expect(other.status).toBe(200)
  expect((await api('requester', 'GET', `/purchase-requisitions/${s.id}`)).body.status).toBe('APPROVED')
})

test('[browser] a manager who is not the requester cannot edit or submit it; the requester can', async ({ browser }) => {
  const d = await draft()
  const alex = await open(browser, 'approver', reqUrl(d.id))
  await expect(badge(alex, 'DRAFT')).toBeVisible()
  await expect(alex.getByRole('button', { name: 'Edit' })).toHaveCount(0)
  await expect(alex.getByRole('button', { name: 'Submit for approval' })).toHaveCount(0)
  await expect(alex.getByRole('button', { name: 'Cancel requisition' })).toHaveCount(0)

  const before = snap()
  expect((await api('approver', 'PATCH', `/purchase-requisitions/${d.id}`, { notes: 'not mine' })).status).toBe(403)
  expect((await api('approver', 'POST', `/purchase-requisitions/${d.id}/submit`)).status).toBe(403)
  expect((await api('approver', 'POST', `/purchase-requisitions/${d.id}/cancel`, {})).status).toBe(403)
  expect(snap()).toEqual(before)

  expect((await api('requester', 'PATCH', `/purchase-requisitions/${d.id}`, { notes: 'mine' })).status).toBe(200)
  expect((await api('requester', 'POST', `/purchase-requisitions/${d.id}/submit`)).status).toBe(200)
})

test('[browser] an admin can withdraw and cancel someone else’s requisition (override) but not edit or submit it', async ({ browser }) => {
  const s = await submitted()
  const before = snap()
  expect((await api('approver', 'POST', `/purchase-requisitions/${s.id}/withdraw`)).status).toBe(403)
  expect((await api('approver', 'POST', `/purchase-requisitions/${s.id}/cancel`, {})).status).toBe(403)
  expect(snap()).toEqual(before)

  const ada = await open(browser, 'admin', reqUrl(s.id))
  await ada.getByRole('button', { name: 'Withdraw for revision' }).click()
  await ada.getByRole('region', { name: 'Withdraw for revision?' }).getByRole('button', { name: 'Withdraw' }).click()
  await expect(badge(ada, 'DRAFT')).toBeVisible()
  await expect(ada.getByRole('button', { name: 'Edit' })).toHaveCount(0)
  await expect(ada.getByRole('button', { name: 'Submit for approval' })).toHaveCount(0)

  const beforeAdminEdit = snap()
  expect((await api('admin', 'PATCH', `/purchase-requisitions/${s.id}`, { notes: 'admin edit' })).status).toBe(403)
  expect((await api('admin', 'POST', `/purchase-requisitions/${s.id}/submit`)).status).toBe(403)
  expect(snap()).toEqual(beforeAdminEdit)

  await ada.getByRole('button', { name: 'Cancel requisition' }).click()
  await ada.getByLabel('Reason (optional)').fill('Requester left')
  await ada.getByRole('region', { name: 'Cancel this requisition?' }).getByRole('button', { name: 'Cancel requisition' }).click()
  await expect(badge(ada, 'CANCELLED')).toBeVisible()
  const rita = await open(browser, 'requester', reqUrl(s.id))
  await expect(rita.getByText(/Ada Admin/)).toBeVisible() // cancelled by the admin, as the requester sees it
  await shot(rita, 'admin-override-cancelled')
})

// ---------------------------------------------------------------- 5. tenant isolation

test('[browser] another tenant cannot read, edit, decide or convert this tenant’s requisitions, nor see them', async ({ browser }) => {
  const pending = await submitted()
  const appr = await approved()
  const d = await draft()
  const before = snap()
  const denied = [
    await api('other', 'GET', `/purchase-requisitions/${pending.id}`),
    await api('other', 'PATCH', `/purchase-requisitions/${d.id}`, { notes: 'cross-tenant' }),
    await api('other', 'POST', `/purchase-requisitions/${d.id}/submit`),
    await api('other', 'POST', `/purchase-requisitions/${pending.id}/withdraw`),
    await api('other', 'POST', `/purchase-requisitions/${pending.id}/cancel`, {}),
    await api('other', 'POST', `/purchase-requisitions/${appr.id}/convert`, {}),
    await api('other', 'POST', `/approvals/${pending.approvalRequestId}/decide`, { approve: true }),
    await api('other', 'GET', `/approvals/${pending.approvalRequestId}`),
  ]
  expect(denied.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404])
  const list = (await api('other', 'GET', '/purchase-requisitions')).body as Array<{ id: string }>
  expect(list.some((r) => [pending.id, appr.id, d.id].includes(r.id))).toBe(false)
  expect(snap()).toEqual(before)

  const olga = await open(browser, 'other', reqUrl(pending.id))
  await expect(olga.getByText('Requisition not found')).toBeVisible()
  await shot(olga, 'cross-tenant-not-found')

  // Paired success: the other tenant works normally in its own tenant, invisibly to this one.
  const own = await api('other', 'POST', '/purchase-requisitions', { supplierId: supplierB, lines: [line()] })
  expect(own.status).toBe(201)
  expect((await api('requester', 'GET', `/purchase-requisitions/${own.body.id}`)).status).toBe(404)
  expect(Object.keys(snap(fx.other!.tenantId).requisitions)).toContain(own.body.number)
})

test('[api] a supplier of another tenant is refused on create and on edit, and nothing is stored', async () => {
  const d = await draft()
  const before = snap()
  const create = await api('requester', 'POST', '/purchase-requisitions', { supplierId: supplierB, lines: [line()] })
  expect(create.status).toBe(400)
  expect(create.body.message).toMatch(/Unknown supplier/)
  const edit = await api('requester', 'PATCH', `/purchase-requisitions/${d.id}`, { supplierId: supplierB })
  expect(edit.status).toBe(400)
  expect(snap()).toEqual(before) // no new requisition, the draft's supplier and timestamp unchanged
  expect((await api('requester', 'PATCH', `/purchase-requisitions/${d.id}`, { supplierId: supplierA })).status).toBe(200)
})

// ---------------------------------------------------------------- 6. validation and integrity

test('[browser] the form refuses negative costs, excessive precision and invalid quantities without saving', async ({ browser }) => {
  const before = snap()
  const rita = await open(browser, 'requester', '/admin/purchasing/requisitions/new')
  await rita.getByLabel('Supplier').selectOption({ label: `${fx.supplier.name} (${fx.supplier.code})` })
  await rita.getByLabel('Line 1 description').fill('Validation check')
  for (const [qty, cost, error] of [
    ['5', '-1', /must be 0 or more/],
    ['5', '1.23456', /at most 4 decimal places/],
    ['1.5', '1', /quantity must be a whole number/],
  ] as const) {
    await rita.getByLabel('Quantity').fill(qty)
    await rita.getByLabel(/^Unit cost/).fill(cost)
    await rita.getByRole('button', { name: 'Save draft' }).click()
    await expect(rita.getByRole('alert').filter({ hasText: error })).toBeVisible()
    await expect(rita).toHaveURL(/\/requisitions\/new$/)
  }
  await shot(rita, 'form-validation-errors')
  expect(snap()).toEqual(before)
})

test('[api] invalid drafts are refused and store nothing', async () => {
  const before = snap()
  const bad = [
    { lines: [line({ unitCost: '-0.01' })] },
    { lines: [line({ unitCost: '1.23456' })] },
    { lines: [line({ qtyRequested: 1.5 })] },
    { lines: [line({ qtyRequested: -1 })] },
    { lines: [line({ description: '' })] },
    { lines: 'nope' },
    { currency: 'DOLLARS' },
    { freightAmount: 'lots' },
    { freightAmount: '1.00001' },
  ]
  for (const body of bad) {
    const r = await api('requester', 'POST', '/purchase-requisitions', { supplierId: supplierA, ...body })
    expect(r.status, JSON.stringify(body)).toBe(400)
  }
  expect(snap()).toEqual(before)
})

test('[api] incomplete drafts cannot be submitted, and a refused submit changes nothing', async () => {
  const drafts = [
    await draft({ supplierId: null }),
    await draft({ lines: [line({ unitCost: null })] }),
    await draft({ lines: [] }),
    await draft({ lines: [line({ qtyRequested: 0 })] }),
  ]
  const before = snap()
  for (const [d, why] of drafts.map((x, i) => [x, [/supplier/, /unit cost/, /at least one line/, /quantity must be more than 0/][i]] as const)) {
    const r = await api('requester', 'POST', `/purchase-requisitions/${d.id}/submit`)
    expect(r.status).toBe(400)
    expect(r.body.message).toMatch(why)
  }
  const after = snap()
  expect(after).toEqual(before)
  for (const d of drafts) expect(after.requisitions[d.number]).toMatchObject({ status: 'DRAFT', revision: 0, approvalRequestId: null })
})

test('[browser] valid 4-decimal costs keep their precision from requisition to PO', async ({ browser }) => {
  const s = await approved({ freightAmount: '0.0001', lines: [line({ qtyRequested: 3, unitCost: '0.0825' }), line({ description: 'Big', qtyRequested: 1, unitCost: '123456.7891' })] })
  const req = await api('requester', 'GET', `/purchase-requisitions/${s.id}`)
  expect(req.body.lines.map((l: { unitCost: string }) => l.unitCost)).toEqual(['0.0825', '123456.7891'])
  expect(req.body.freightAmount).toBe('0.0001')
  const po = await api('approver', 'POST', `/purchase-requisitions/${s.id}/convert`, {})
  expect(po.status).toBe(201)
  expect(po.body.lines.map((l: { unitCost: string }) => l.unitCost)).toEqual(['0.0825', '123456.7891'])
  expect(po.body.freightAmount).toBe('0.0001')
  const page = await open(browser, 'approver', `/admin/purchasing/${po.body.id}`)
  await expect(page.getByRole('cell', { name: '$0.0825' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '$0.2475' })).toBeVisible() // 3 x 0.0825, exact
  await expect(page.getByRole('cell', { name: '$123456.7891' }).first()).toBeVisible()
  await shot(page, 'po-four-decimal-costs')
})

test('[api] a conversion payload that tries to replace purchasing details is refused', async () => {
  const s = await approved()
  const before = snap()
  for (const body of [
    { supplierId: supplierA },
    { lines: [line({ unitCost: '0.01' })] },
    { freightAmount: '0' },
    { tenantId: fx.other!.tenantId },
    { number: 'PO-OK-1', unitCost: '1' },
  ]) {
    const r = await api('approver', 'POST', `/purchase-requisitions/${s.id}/convert`, body)
    expect(r.status, JSON.stringify(body)).toBe(400)
  }
  expect(snap()).toEqual(before)
  const ok = await api('approver', 'POST', `/purchase-requisitions/${s.id}/convert`, { number: `PO-E2E-${randomUUID().slice(0, 6)}` })
  expect(ok.status).toBe(201)
})

// ---------------------------------------------------------------- 7. duplicate actions and stale pages

test('[api] concurrent conversions create exactly one PO; a retry returns the same PO', async () => {
  const s = await approved()
  const before = snap()
  const results = await Promise.all(Array.from({ length: 6 }, () => api('approver', 'POST', `/purchase-requisitions/${s.id}/convert`, {})))
  const ids = new Set(results.map((r) => r.body?.id))
  expect(ids.size).toBe(1)
  expect(results.filter((r) => r.status === 201)).toHaveLength(1)
  expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true)
  const after = snap()
  expect(after.purchaseOrders).toBe(before.purchaseOrders + 1)

  const retry = await api('admin', 'POST', `/purchase-requisitions/${s.id}/convert`, {})
  expect(retry.status).toBe(200)
  expect(retry.body.id).toBe([...ids][0])
  const otherNumber = await api('approver', 'POST', `/purchase-requisitions/${s.id}/convert`, { number: 'PO-SOMETHING-ELSE' })
  expect(otherNumber.status).toBe(409)
  expect(snap()).toEqual(after)
})

test('[browser] a requester page left open while an admin cancels: the conflict is explained and the page refreshes', async ({ browser }) => {
  const s = await submitted()
  const rita = await open(browser, 'requester', reqUrl(s.id))
  await expect(badge(rita, 'PENDING APPROVAL')).toBeVisible()
  expect((await api('admin', 'POST', `/purchase-requisitions/${s.id}/cancel`, { reason: 'Cancelled elsewhere' })).status).toBe(200)
  const before = snap()
  await rita.getByRole('button', { name: 'Withdraw for revision' }).click()
  await rita.getByRole('region', { name: 'Withdraw for revision?' }).getByRole('button', { name: 'Withdraw' }).click()
  await expect(rita.getByRole('alert').filter({ hasText: 'has been reloaded' })).toBeVisible()
  await expect(badge(rita, 'CANCELLED')).toBeVisible()
  await shot(rita, 'stale-page-refreshed')
  expect(snap()).toEqual(before)
})

test('[browser] an approver page left open while the requester withdraws: Approve fails safely and the page refreshes', async ({ browser }) => {
  const s = await submitted()
  const alex = await open(browser, 'approver', reqUrl(s.id))
  await expect(alex.getByRole('button', { name: 'Approve' })).toBeVisible()
  expect((await api('requester', 'POST', `/purchase-requisitions/${s.id}/withdraw`)).status).toBe(200)
  const before = snap()
  await alex.getByRole('button', { name: 'Approve' }).click()
  await expect(alex.getByRole('alert')).toBeVisible()
  await shot(alex, 'stale-approver-page')
  expect(snap()).toEqual(before) // the closed request was not approved
  // Expected: the page reloads and shows the requisition as a draft, with no Approve button left.
  await expect(badge(alex, 'DRAFT')).toBeVisible({ timeout: 5_000 })
  await expect(alex.getByRole('button', { name: 'Approve' })).toHaveCount(0)
})

test('[browser] an approver page left open while the requester withdraws: Reject fails safely and the page refreshes', async ({ browser }) => {
  const s = await submitted()
  const alex = await open(browser, 'approver', reqUrl(s.id))
  await expect(alex.getByRole('button', { name: 'Reject' })).toBeVisible()
  expect((await api('requester', 'POST', `/purchase-requisitions/${s.id}/withdraw`)).status).toBe(200)
  const before = snap()
  await alex.getByRole('button', { name: 'Reject' }).click()
  await alex.getByLabel('Reason (required)').fill('Too late')
  await alex.getByRole('region', { name: 'Reject this requisition?' }).getByRole('button', { name: 'Reject' }).click()
  await expect(alex.getByRole('alert').filter({ hasText: 'changed in another session' })).toBeVisible()
  await expect(badge(alex, 'DRAFT')).toBeVisible({ timeout: 5_000 })
  for (const name of ['Approve', 'Reject']) await expect(alex.getByRole('button', { name })).toHaveCount(0)
  await expect(alex.getByRole('region', { name: 'Reject this requisition?' })).toHaveCount(0)
  await shot(alex, 'stale-reject-refreshed')
  expect(snap()).toEqual(before) // the closed request was not rejected
})

test('[browser] a refused decision that is not stale (validation) keeps the page as it was; a valid decision then succeeds', async ({ browser }) => {
  const s = await submitted()
  const alex = await open(browser, 'approver', reqUrl(s.id))
  await alex.getByRole('button', { name: 'Reject' }).click()
  await alex.getByLabel('Reason (required)').fill('Will be stripped')
  // The UI never sends an empty reason, so strip it in flight to reach the server's own validation (400).
  await alex.route('**/api/v1/approvals/*/decide', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    await route.continue({ postData: JSON.stringify({ ...body, rejectReason: '' }) })
  })
  const before = snap()
  await alex.getByRole('region', { name: 'Reject this requisition?' }).getByRole('button', { name: 'Reject' }).click()
  await expect(alex.getByRole('alert').filter({ hasText: 'rejectReason is required' })).toBeVisible()
  await expect(alex.getByRole('alert').filter({ hasText: 'changed in another session' })).toHaveCount(0)
  await expect(badge(alex, 'PENDING APPROVAL')).toBeVisible()
  await expect(alex.getByRole('region', { name: 'Reject this requisition?' })).toBeVisible() // panel and reason kept
  await expect(alex.getByLabel('Reason (required)')).toHaveValue('Will be stripped')
  await expect(alex.getByRole('button', { name: 'Approve' })).toBeVisible()
  expect(snap()).toEqual(before)
  await shot(alex, 'decision-validation-error-kept')

  await alex.unroute('**/api/v1/approvals/*/decide')
  await alex.getByRole('region', { name: 'Reject this requisition?' }).getByRole('button', { name: 'Reject' }).click()
  await expect(badge(alex, 'REJECTED')).toBeVisible()
  expect(snap().approvalRequests[s.approvalRequestId]).toBe('REJECTED')
})

test('[browser] an authorized approval of a current pending requisition still succeeds from its page', async ({ browser }) => {
  const s = await submitted()
  const alex = await open(browser, 'approver', reqUrl(s.id))
  await alex.getByRole('button', { name: 'Approve' }).click()
  await expect(badge(alex, 'APPROVED')).toBeVisible()
  await expect(alex.getByRole('alert')).toHaveCount(0)
  const after = snap()
  expect(after.approvalRequests[s.approvalRequestId]).toBe('APPROVED')
  expect(after.requisitions[s.number].status).toBe('APPROVED')
})

// ---------------------------------------------------------------- 8. direct creation bypass

test('[browser] there is no direct PO creation in the UI; a requisition is the way in', async ({ browser }) => {
  for (const who of ['requester', 'admin'] as Who[]) {
    const page = await open(browser, who, '/admin/purchasing')
    await expect(page.getByRole('link', { name: 'New requisition' }).first()).toBeVisible() // header (and empty-state) link
    await expect(page.getByRole('button', { name: /New PO/ })).toHaveCount(0)
    if (who === 'admin') await shot(page, 'purchasing-no-direct-po')
  }
})

test('[api] direct PO creation is refused for managers and admins, even with a forged requisitionId; nothing is created', async () => {
  const s = await approved()
  const before = snap()
  const body = { supplierId: supplierA, number: `PO-DIRECT-${randomUUID().slice(0, 6)}`, lines: [{ lineNo: 1, description: 'x', qtyOrdered: 1, unitCost: 1 }] }
  for (const who of ['requester', 'approver', 'admin'] as Who[]) {
    const r = await api(who, 'POST', '/purchase-orders', body)
    expect(r.status).toBe(405)
    expect(r.body.message).toMatch(/purchase requisition/)
  }
  const forged = await api('admin', 'POST', '/purchase-orders', { ...body, requisitionId: s.id, createdBy: 'forged' })
  expect(forged.status).toBe(405)
  expect(snap()).toEqual(before)
  // Paired success: the approved requisition is the way to a PO.
  expect((await api('approver', 'POST', `/purchase-requisitions/${s.id}/convert`, {})).status).toBe(201)
})

test.fixme('KNOWN UNRESOLVED BYPASS: drop-ship creates and submits POs without a requisition or approval', async () => {
  // Not a passing control. Order processing (and POST /orders/{id}/drop-ship/create-po with orders.write) still creates
  // drop-ship POs with no requisition; see createDropShipPurchaseOrder in apps/web/lib/server/purchasing.ts and
  // ERP_FEATURE_GAP.md. Turn this into a real assertion once the drop-ship approval policy is decided.
})
