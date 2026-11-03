import AxeBuilder from '@axe-core/playwright'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { loginAdmin, loginBuyer } from './helpers/auth'

// ClickUp 67: every field, dropdown and button on these screens has a name a screen reader can announce.
// Runs only axe's naming rules; contrast and layout are a separate piece of work.

const NAMING_RULES = [
  'label',
  'select-name',
  'button-name',
  'input-button-name',
  'link-name',
  'aria-input-field-name',
  'aria-toggle-field-name',
  'aria-command-name',
]

async function unnamedControls(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withRules(NAMING_RULES).analyze()
  return violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} — ${n.html.slice(0, 120)}`))
}

async function expectAllNamed(page: Page) {
  // Wait for the page's data so the check sees the real controls, not a loading skeleton.
  await page.waitForLoadState('networkidle')
  expect(await unnamedControls(page)).toEqual([])
}

test.describe('admin screens', () => {
  // Sign in once: logins are rate limited (10 per email per 5 minutes).
  let adminState: Awaited<ReturnType<BrowserContext['storageState']>>
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    await loginAdmin(await ctx.newPage())
    adminState = await ctx.storageState()
    await ctx.close()
  })
  test.use({ storageState: async ({}, use) => use(adminState) })

  test('Settings → Users, the invite dialog and change password', async ({ page }) => {
    await page.goto('/admin/settings?tab=users')
    await expect(page.getByRole('heading', { name: 'Change your password' })).toBeVisible()
    await expectAllNamed(page)
    await page.getByRole('button', { name: /invite/i }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectAllNamed(page)
  })

  test('Fulfillment list and a task', async ({ page }) => {
    await page.goto('/admin/fulfillment')
    await expectAllNamed(page)
    const task = page.locator('a[href*="/admin/fulfillment/"]').first()
    await task.click()
    await expect(page.getByLabel('Assign picker (optional)')).toBeVisible()
    await expectAllNamed(page)
  })

  for (const tab of ['picks', 'waves', 'bins', 'receiving', 'putaway', 'labor', 'counts']) {
    test(`Warehouse → ${tab}`, async ({ page }) => {
      await page.goto(`/admin/warehouse?tab=${tab}`)
      await expectAllNamed(page)
    })
  }

  for (const path of ['/admin/dispatch', '/admin/inventory', '/admin/approvals']) {
    test(path, async ({ page }) => {
      await page.goto(path)
      await expectAllNamed(page)
    })
  }

  test('Inventory → New SKU', async ({ page }) => {
    await page.goto('/admin/inventory')
    await page.getByRole('button', { name: 'New SKU' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectAllNamed(page)
  })
})

test.describe('buyer screens', () => {
  test('catalog and checkout', async ({ page }) => {
    await loginBuyer(page)
    await page.goto('/catalog')
    await expectAllNamed(page)
    // Checkout needs something in the cart; only in-stock products have an Add button.
    await page.getByRole('button', { name: 'In Stock' }).click()
    await page.getByRole('button', { name: /^Add\b/ }).first().click()
    await page.goto('/checkout')
    await expect(page.getByLabel('Address line 1')).toBeVisible()
    await expectAllNamed(page)
  })
})
