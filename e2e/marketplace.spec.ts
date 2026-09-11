import { expect, test } from '@playwright/test'
import { loginAdmin } from './helpers/auth'

test.describe('Marketplace', () => {
  test('admin sidebar shows Marketplace and browse lists seeded peer listing', async ({ page }) => {
    await loginAdmin(page)
    await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toContainText('Marketplace')

    await page.goto('/admin/marketplace')
    await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible()
    await expect(page.getByText('Sticky Notes Bulk — peer listing')).toBeVisible()
  })

  test('sales rep sees Marketplace nav without settings access', async ({ page }) => {
    await loginAdmin(page, 'sales@pleros.local', 'sales1234')
    await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toContainText('Marketplace')
    await page.goto('/admin/marketplace')
    await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible()
  })

  test('listing detail page loads for a live listing', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/marketplace')
    await page.getByRole('link', { name: /Sticky Notes Bulk — peer listing/i }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Sticky Notes Bulk')
    await expect(page.getByText('Office Supplies')).toBeVisible()
  })

  test('shop marketplace route is reachable when signed in', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/marketplace')
    await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Marketplace' })).toBeVisible()
  })

  test('peer tenant can browse demo seller listing', async ({ page }) => {
    await loginAdmin(page, 'peer@pleros.local', 'peer1234')
    await page.goto('/admin/marketplace')
    await expect(page.getByText('Office Pen Pack (100) — demo listing')).toBeVisible()
  })
})
