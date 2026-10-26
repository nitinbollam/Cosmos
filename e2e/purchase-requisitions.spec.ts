import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { loginAdmin } from './helpers/auth'
import type { RequisitionFixture } from './fixtures/requisition-fixture'

// Purchase requisitions end to end: raise, approve by a different manager, convert, submit the PO; reject, revise,
// resubmit; and access control. Uses its own tenant (fixtures/requisition-fixture.ts), created here and removed after.

const webDir = path.resolve(__dirname, '../apps/web')
const fixtureScript = path.resolve(__dirname, 'fixtures/requisition-fixture.ts')

function fixture(...args: string[]): string {
  return execFileSync(process.execPath, ['--import', './server/register-paths.mjs', '--import', 'tsx', fixtureScript, ...args], {
    cwd: webDir,
    encoding: 'utf8',
    env: process.env,
  })
}

let fx: RequisitionFixture

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  const out = fixture('create').trim().split('\n').pop() as string
  fx = JSON.parse(out) as RequisitionFixture
})

test.afterAll(() => {
  if (fx) fixture('cleanup', fx.tenantId)
})

async function signedIn(browser: Browser, who: keyof RequisitionFixture['users']): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await loginAdmin(page, fx.users[who], fx.password)
  return page
}

async function raiseRequisition(page: Page, qty: string, description: string): Promise<string> {
  await page.goto('/admin/purchasing/requisitions/new')
  await page.getByLabel('Supplier').selectOption({ label: `${fx.supplier.name} (${fx.supplier.code})` })
  await page.getByLabel('Line 1 description').fill(description)
  await page.getByLabel('Quantity').fill(qty)
  await page.getByLabel(/^Unit cost/).fill('4.2525')
  await page.getByLabel(/^Freight/).fill('12.50')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await page.waitForURL(/\/admin\/purchasing\/requisitions\/(?!new)[^/]+$/)
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible()
  return page.url().split('/').pop() as string
}

test('requester raises and submits; a different manager approves; the PO is converted and submitted', async ({ browser }) => {
  const requester = await signedIn(browser, 'requester')
  const id = await raiseRequisition(requester, '1000', 'Blue widget, boxed')
  await expect(requester.getByText('$4,265.00')).toBeVisible() // 1000 x 4.2525 + 12.50, exact

  await requester.getByRole('button', { name: 'Submit for approval' }).click()
  await expect(requester.getByText('PENDING APPROVAL', { exact: true })).toBeVisible()
  await expect(requester.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  await expect(requester.getByText('You raised this requisition, so another manager or admin approves it.')).toBeVisible()

  const approver = await signedIn(browser, 'approver')
  await approver.goto('/admin/approvals')
  await approver.getByRole('combobox').first().selectOption('PURCHASE_REQUISITION')
  const row = approver.locator('tr', { hasText: 'Requisition PR-' }).first()
  await row.getByRole('button', { name: 'Approve' }).click()
  await approver.goto(`/admin/purchasing/requisitions/${id}`)
  await expect(approver.getByText('APPROVED', { exact: true }).first()).toBeVisible()

  await approver.getByRole('button', { name: 'Convert to PO' }).click()
  await approver.getByRole('button', { name: 'Create PO' }).click()
  await approver.waitForURL(/\/admin\/purchasing\/(?!requisitions)[^/]+$/)
  const poUrl = approver.url()
  await expect(approver.getByText('Source requisition')).toBeVisible()
  await expect(approver.getByRole('cell', { name: '$4.2525' })).toBeVisible() // the approved 4-decimal cost, exact
  await expect(approver.getByRole('cell', { name: '$4252.50' })).toBeVisible()

  await approver.getByRole('button', { name: 'Submit PO' }).click()
  await expect(approver.getByText('SUBMITTED', { exact: true })).toBeVisible()
  await expect(approver.getByText('Awaiting manager approval')).toHaveCount(0)

  // The converted requisition opens the same PO.
  await approver.goto(`/admin/purchasing/requisitions/${id}`)
  await approver.getByRole('link', { name: 'Open purchase order' }).click()
  await expect(approver).toHaveURL(poUrl)
})

test('rejection, revision and resubmission need a fresh approval', async ({ browser }) => {
  const requester = await signedIn(browser, 'requester')
  const id = await raiseRequisition(requester, '50', 'Second order')
  await requester.getByRole('button', { name: 'Submit for approval' }).click()
  await expect(requester.getByText('PENDING APPROVAL', { exact: true })).toBeVisible()

  const approver = await signedIn(browser, 'approver')
  await approver.goto(`/admin/purchasing/requisitions/${id}`)
  await approver.getByRole('button', { name: 'Reject' }).click()
  const confirm = approver.getByRole('region', { name: 'Reject this requisition?' }).getByRole('button', { name: 'Reject' })
  await expect(confirm).toBeDisabled()
  await approver.getByLabel('Reason (required)').fill('Order 40, not 50')
  await confirm.click()
  await expect(approver.getByText('REJECTED', { exact: true }).first()).toBeVisible()

  await requester.reload()
  await expect(requester.getByText('“Order 40, not 50”')).toBeVisible()
  await requester.getByRole('button', { name: 'Edit' }).click()
  await requester.getByLabel('Quantity').fill('40')
  await requester.getByRole('button', { name: 'Save changes' }).click()
  await requester.getByRole('button', { name: 'Resubmit for approval' }).click()
  await expect(requester.getByText('Revision 2')).toBeVisible()

  await approver.reload()
  await approver.getByRole('button', { name: 'Approve' }).click()
  await expect(approver.getByText('APPROVED', { exact: true }).first()).toBeVisible()
})

test('a user without requisition access cannot see or act on requisitions', async ({ browser, request }) => {
  const requester = await signedIn(browser, 'requester')
  const id = await raiseRequisition(requester, '5', 'Access check')

  const rep = await signedIn(browser, 'rep')
  await expect(rep.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Requisitions' })).toHaveCount(0)
  await rep.goto(`/admin/purchasing/requisitions/${id}`)
  await expect(rep.getByText("You don't have access to requisitions")).toBeVisible()

  const login = await request.post('/api/v1/auth/login', { data: { email: fx.users.rep, password: fx.password } })
  const token = ((await login.json()) as { accessToken: string }).accessToken
  const headers = { authorization: `Bearer ${token}` }
  expect((await request.get(`/api/v1/purchase-requisitions/${id}`, { headers })).status()).toBe(403)
  expect((await request.post(`/api/v1/purchase-requisitions/${id}/submit`, { headers })).status()).toBe(403)
  expect((await request.post(`/api/v1/purchase-requisitions/${id}/convert`, { headers, data: {} })).status()).toBe(403)
})
