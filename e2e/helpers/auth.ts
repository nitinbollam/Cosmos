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
