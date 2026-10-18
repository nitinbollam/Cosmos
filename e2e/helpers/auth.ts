import type { Page } from '@playwright/test'

export async function loginAdmin(page: Page, email = 'admin@pleros.local', password = 'admin1234') {
  await page.goto('/admin/login')
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Password').fill(password)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL(/\/admin(\/)?$|\/admin\/(?!login)/)
}

export async function loginStaff(page: Page, email: string, password: string) {
  await loginAdmin(page, email, password)
}

/** Buyer portal sign-in (the shop surface keeps its own session, separate from /admin). */
export async function loginBuyer(page: Page, email = 'buyer@acme-retail.com', password = 'buyer1234') {
  await page.goto('/login')
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}
