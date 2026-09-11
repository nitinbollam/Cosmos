import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PLEROS_E2E_PORT ?? 4000)
const baseURL = process.env.PLEROS_E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: './e2e/global-setup.mjs',
  webServer: process.env.PLEROS_E2E_SKIP_SERVER
    ? undefined
    : {
        command: 'npm run e2e:server',
        url: `${baseURL}/api/v1/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
})
