import path from 'node:path'
import { defineConfig } from '@playwright/test'
import { assertDisposableEnv } from '../bank-reconciliation-local/disposable-env.mjs'

/**
 * Buyer (Phase 6) and admin (Phase 7, QTEST_SPEC=admin) quote browser checks. Run only through launch.mjs, which starts the server against disposable databases
 * first. Deliberately no globalSetup and no webServer: the repository's e2e/global-setup.mjs migrates and seeds
 * the developer databases.
 */
const tmp = process.env.BANKTEST_DEMO_TMP ?? ''
const baseURL = process.env.BANKTEST_DEMO_BASE_URL ?? ''
assertDisposableEnv(process.env, tmp)
if (!/^http:\/\/localhost:\d+$/.test(baseURL)) throw new Error('Refusing: BANKTEST_DEMO_BASE_URL must be http://localhost:<port> (run through launch.mjs)')

export default defineConfig({
  testDir: '.',
  testMatch: process.env.QTEST_SPEC === 'admin' ? /admin-quote\.local\.ts$/ : /buyer-quote\.local\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: path.join(tmp, 'playwright-output'),
  use: {
    baseURL,
    channel: process.env.BANKTEST_DEMO_BROWSER_CHANNEL || 'chrome',
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
})
