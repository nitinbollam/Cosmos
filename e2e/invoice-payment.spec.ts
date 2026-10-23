import { expect, test, type Page } from '@playwright/test'
import { loginAdmin } from './helpers/auth'
import { createOpenInvoice } from './helpers/open-invoice'

// Rejected amounts must explain themselves, keep what was typed, and record nothing.
const REJECTED: Array<[string, RegExp]> = [
  ['-10', /must be greater than zero/],
  ['0', /must be greater than zero/],
  ['90', /more than the remaining balance of \$51\.04/],
  ['10abc', /must be a number/],
  ['10.005', /at most 2 decimal places/],
]

test.describe('Recording an invoice payment', () => {
  let inv: Awaited<ReturnType<typeof createOpenInvoice>>

  test.beforeEach(async () => {
    inv = await createOpenInvoice('51.04')
  })
  test.afterEach(async () => {
    await inv?.remove()
  })

  async function submitAndExpectError(page: Page, submit: () => Promise<void>, amount: string, message: RegExp) {
    const input = page.getByLabel('Payment amount')
    await input.fill(amount)
    await expect(page.getByRole('alert')).toHaveCount(0) // editing clears the previous error
    await submit()
    await expect(page.getByRole('alert')).toHaveText(message)
    await expect(input).toHaveValue(amount)
  }

  test('finance receivables: the modal shows why an amount was rejected and keeps it', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/finance')
    const row = page.getByRole('row', { name: new RegExp(inv.invoiceNumber) })
    await row.getByRole('button', { name: 'Record payment' }).click()
    await expect(page.getByRole('heading', { name: 'Receive payment' })).toBeVisible()
    await expect(page.getByLabel('Payment amount')).toHaveValue('51.04')

    const submit = () => page.getByRole('button', { name: 'Submit' }).click()
    for (const [amount, message] of REJECTED) await submitAndExpectError(page, submit, amount, message)
    expect(await inv.amountPaid()).toBe('0.00')
    expect(await inv.postingJobs()).toBe(0)

    // A valid partial payment still goes through and closes the modal.
    await page.getByLabel('Payment amount').fill('20.00')
    await submit()
    await expect(page.getByRole('heading', { name: 'Receive payment' })).toHaveCount(0)
    await expect.poll(() => inv.amountPaid()).toBe('20.00')
  })

  test('order payment panel: the same errors show under the order', async ({ page }) => {
    await loginAdmin(page)
    await page.goto(`/admin/orders/${inv.orderId}`)
    await page.getByRole('button', { name: 'Record payment' }).click()

    const submit = () => page.getByRole('button', { name: 'Record', exact: true }).click()
    for (const [amount, message] of REJECTED) await submitAndExpectError(page, submit, amount, message)
    expect(await inv.amountPaid()).toBe('0.00')
    expect(await inv.postingJobs()).toBe(0)
  })
})
