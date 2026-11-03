import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('driver route distinguishes unlinked, empty linked, and populated order stops', async ({ page }) => {
  await page.goto('/m/login')
  await page.getByPlaceholder('Email').fill('driver@pleros.local')
  await page.getByPlaceholder('Password').fill('driver1234')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/m\/delivery$/)

  await page.route((url) => url.pathname === '/api/v1/routes/e2e-unlinked-stops', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'e2e-unlinked-stops',
        name: 'Unlinked stop regression route',
        status: 'ASSIGNED',
        stops: [
          { id: 'unlinked', sequence: 1, status: 'PENDING', address: { line1: 'Manual address' }, items: [], hasLinkedOrder: false },
          { id: 'populated', sequence: 2, status: 'PENDING', address: { line1: 'Order address' }, items: [{ skuCode: 'BEV-ENG-200', name: 'Energy Drink Case (24)', quantity: 2, ageRestricted: false, minimumAge: null }], hasLinkedOrder: true },
          { id: 'empty-linked', sequence: 3, status: 'PENDING', address: { line1: 'Empty order address' }, items: [], hasLinkedOrder: true },
        ],
      }),
    })
  })

  await page.goto('/m/delivery/route/e2e-unlinked-stops')
  await expect(page.getByText('No order linked', { exact: true })).toBeVisible()
  await expect(page.getByText('Energy Drink Case (24)', { exact: true })).toBeVisible()
  await expect(page.getByText('No products on linked order', { exact: true })).toBeVisible()
  await expect(page.getByText('No order linked', { exact: true })).toHaveCount(1)
})
