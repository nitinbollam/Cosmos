#!/usr/bin/env node
/**
 * Start the unified dev server for Playwright E2E (Vite + API on PORT / default 4000).
 * DB migrate + seed run in e2e/global-setup.ts before this starts.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const child = spawn(npm, ['run', 'dev:client'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' },
  shell: process.platform === 'win32',
})

child.on('exit', (code) => process.exit(code ?? 0))

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig))
}
