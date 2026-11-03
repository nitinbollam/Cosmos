import path from 'node:path'
import { defineConfig } from '@playwright/test'
import { assertDisposableEnv } from './disposable-env.mjs'

/**
 * Browser checks for the local bank-reconciliation demo. Run only through launch.mjs, which starts
 * the server against disposable databases first. Deliberately no globalSetup and no webServer: the
 * repository's e2e/global-setup.mjs prepares, migrates and seeds the developer databases.
 */
const tmp = process.env.BANKTEST_DEMO_TMP ?? ''
const baseURL = process.env.BANKTEST_DEMO_BASE_URL ?? ''
assertDisposableEnv(process.env, tmp)
if (!/^http:\/\/localhost:\d+$/.test(baseURL)) throw new Error('Refusing: BANKTEST_DEMO_BASE_URL must be http://localhost:<port> (run through launch.mjs)')

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.local\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: path.join(tmp, 'playwright-output'),
  use: {
    baseURL,
    // The installed Chrome by default, so no browser download is needed.
    channel: process.env.BANKTEST_DEMO_BROWSER_CHANNEL || 'chrome',
    headless: true,
    acceptDownloads: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
})
