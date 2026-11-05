import { expect, test } from '@playwright/test'
import { loginAdmin } from './helpers/auth'

// Offline support registers a service worker that forwards API requests around Playwright routes.
// Block it here so SKU fixtures stay deterministic and the browser test does not rely on SW caches.
test.use({ serviceWorkers: 'block' })

test.describe('Purchasing and requisitions', () => {
  test('a requisition draft supports keyboard SKU search and keeps the manual description', async ({ page }) => {
    await loginAdmin(page)
    await page.route((url) => url.pathname === '/api/v1/skus' && url.searchParams.has('search'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            { id: 'sku-energy', code: 'ENE-001', name: 'Energy drink', isActive: true },
            { id: 'sku-engine', code: 'ENG-002', name: 'Engine oil', isActive: true },
            { id: 'sku-inactive', code: 'ENE-OLD', name: 'Inactive item', isActive: false },
          ],
        }),
      })
    })

    await page.goto('/admin/purchasing/requisitions/new')
    await expect(page.getByRole('heading', { name: 'New requisition' })).toHaveCount(1)
    const description = page.getByLabel('Line 1 description')
    const sku = page.getByRole('combobox', { name: 'Line 1 SKU (optional)' })
    await description.fill('Custom buyer description')
    await sku.fill('ENE')

    const energy = page.getByRole('option', { name: /ENE-001 Energy drink/ })
    const engine = page.getByRole('option', { name: /ENG-002 Engine oil/ })
    await expect(energy).toBeVisible()
    await expect(page.getByRole('option', { name: /ENE-OLD/ })).toHaveCount(0)
    await sku.press('ArrowDown')
    await expect(energy).toHaveAttribute('aria-selected', 'true')
    await sku.press('ArrowDown')
    await expect(engine).toHaveAttribute('aria-selected', 'true')
    await sku.press('ArrowUp')
    await expect(energy).toHaveAttribute('aria-selected', 'true')
    await sku.press('Enter')
    await expect(sku).toHaveValue('ENE-001')
    await expect(description).toHaveValue('Custom buyer description')

    await sku.fill('ENG')
    await expect(engine).toBeVisible()
    await sku.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(sku).toHaveValue('ENG')
    await expect(description).toHaveValue('Custom buyer description')

    // SKU, supplier, and unit cost are all optional while saving a draft.
    await sku.fill('')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page).toHaveURL(/\/admin\/purchasing\/requisitions\/[^/?]+$/)
    await expect(page.getByText('Custom buyer description')).toBeVisible()
  })

  test('a low-stock purchasing link opens a prefilled requisition and the PO approval filter remains available', async ({ page }) => {
    await loginAdmin(page)
    await page.route((url) => url.pathname === '/api/v1/skus/e2e-low-stock/reorder-suggestion', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sku: { code: 'LOW-001', name: 'Low stock item' }, suggestedQty: 7 }),
      })
    })

    await page.goto('/admin/purchasing?skuId=e2e-low-stock')
    await expect(page).toHaveURL(/\/admin\/purchasing\/requisitions\/new\?skuId=e2e-low-stock$/)
    await expect(page.getByLabel('Line 1 description')).toHaveValue('Low stock item')
    await expect(page.getByRole('combobox', { name: 'Line 1 SKU (optional)' })).toHaveValue('LOW-001')
    await expect(page.getByLabel('Quantity')).toHaveValue('7')

    await page.goto('/admin/purchasing')
    const pendingFilterRequest = page.waitForRequest((request) => {
      const url = new URL(request.url())
      return url.pathname.endsWith('/purchase-orders') && url.searchParams.get('status') === 'PENDING_APPROVAL'
    })
    await page.getByRole('button', { name: 'Pending Approval' }).click()
    await pendingFilterRequest
  })

  test('a submitted requisition waits for a different approver before it can become a PO', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/purchasing/requisitions/new')
    await page.getByLabel('Supplier').selectOption({ label: 'Pacific Supply Co. (PAC-VAP)' })
    await page.getByLabel('Line 1 description').fill('Approval-gated order')
    await page.getByLabel('Unit cost (USD)').fill('2.50')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page).toHaveURL(/\/admin\/purchasing\/requisitions\/[^/?]+$/)

    await page.getByRole('button', { name: 'Submit for approval' }).click()
    await expect(page.getByText('PENDING APPROVAL', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
    await expect(page.getByText('You raised this requisition, so another manager or admin approves it.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Convert to PO' })).toHaveCount(0)
  })

  test('supplier creation shows accessible required-field errors with consistent input spacing', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/purchasing')
    await page.getByRole('button', { name: 'Suppliers' }).click()
    await page.getByRole('button', { name: 'New supplier' }).first().click()

    await expect(page.getByRole('heading', { name: 'New supplier' })).toHaveCount(1)
    const code = page.getByLabel('Supplier code')
    const name = page.getByLabel('Supplier name')
    await expect(code).toHaveClass(/mt-1/)
    await expect(name).toHaveClass(/mt-1/)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(code).toHaveAttribute('aria-invalid', 'true')
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('Enter a supplier code.')).toBeVisible()
    await expect(page.getByText('Enter a supplier name.')).toBeVisible()

    await code.fill('E2E-SUPPLIER')
    await name.fill('E2E Supplier')
    const email = page.getByLabel('Email (optional)')
    await email.fill('not-an-email')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(email).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('Enter a valid email address.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'New supplier' })).toBeVisible()
  })
})
