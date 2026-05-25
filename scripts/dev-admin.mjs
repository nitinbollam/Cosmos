#!/usr/bin/env node
/**
 * Faster local dev: web-admin + gateway + domain services only.
 * Skips mobile apps, storefront, POS, and Python AI sidecars.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const pnpm = path.join(root, 'node_modules', '.bin', isWin ? 'pnpm.cmd' : 'pnpm')

const filters = [
  '@cosmos/gateway-service',
  '@cosmos/auth-service',
  '@cosmos/tenant-service',
  '@cosmos/inventory-service',
  '@cosmos/wms-service',
  '@cosmos/order-service',
  '@cosmos/purchasing-service',
  '@cosmos/compliance-service',
  '@cosmos/crm-service',
  '@cosmos/dispatch-service',
  '@cosmos/payment-service',
  '@cosmos/ledger-service',
  '@cosmos/analytics-service',
  '@cosmos/notification-service',
  '@cosmos/web-admin',
]

const args = ['exec', 'turbo', 'run', 'dev', '--concurrency=16', ...filters.flatMap((f) => ['--filter', f])]

console.log('[dev:admin] Starting admin stack (no Python, no mobile, no storefront)…')
console.log('[dev:admin]', pnpm, args.join(' '))

const child = spawn(pnpm, args, { cwd: root, stdio: 'inherit', shell: isWin })
child.on('exit', (code) => process.exit(code ?? 0))
