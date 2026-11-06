import { expect, test } from '@playwright/test'

test('an unavailable cancellation request does not hide a non-buyer order detail page', async ({ page }) => {
  const orderId = 'order-review-56'
  const payload = btoa(JSON.stringify({ sub: 'staff-user', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 }))
  await page.addInitScript((jwtPayload) => {
    localStorage.setItem('pleros.shop.accessToken', `e30.${jwtPayload}.signature`)
  }, payload)

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === `/api/v1/orders/${orderId}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: orderId,
          orderNumber: 56,
          status: 'PROCESSING',
          channel: 'B2B_PORTAL',
          customerId: 'customer-1',
          totalAmount: '25.00',
          taxAmount: '0',
          createdAt: new Date().toISOString(),
          lineItems: [],
        }),
      })
      return
    }
    if (url.pathname === `/api/v1/orders/${orderId}/cancellation-requests`) {
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Forbidden' }) })
      return
    }
    if (url.pathname === `/api/v1/orders/${orderId}/tracking`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orderStatus: 'PROCESSING', shipments: [], delivery: null }),
      })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) })
  })

  await page.goto(`/orders/${orderId}`)
  await expect(page.getByRole('heading', { name: 'Order #ORD-56' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Line items' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Cancellation request' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Request cancellation' })).toHaveCount(0)
  await expect(page.getByText('Forbidden')).toHaveCount(0)
})
