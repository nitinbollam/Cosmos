#!/usr/bin/env node
/**
 * Generates Prisma clients for every DB-backed service sequentially.
 * Run this once after `pnpm install` and any time a schema.prisma changes.
 * Usage: node scripts/generate-all-prisma.mjs
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const pnpmBin =
  process.platform === 'win32'
    ? path.join(root, 'node_modules', '.bin', 'pnpm.cmd')
    : path.join(root, 'node_modules', '.bin', 'pnpm')
const pnpmCmd = fs.existsSync(pnpmBin) ? `"${pnpmBin}"` : 'pnpm'

const DB_SERVICES = [
  'services/auth-service',
  'services/tenant-service',
  'services/inventory-service',
  'services/wms-service',
  'services/order-service',
  'services/purchasing-service',
  'services/compliance-service',
  'services/storefront-service',
  'services/pos-service',
  'services/crm-service',
  'services/dispatch-service',
  'services/payment-service',
  'services/ledger-service',
  'services/analytics-service',
  'services/notification-service',
]

let passed = 0
let failed = 0
const errors = []

for (const svc of DB_SERVICES) {
  const svcPath = path.join(root, svc)
  const schemaPath = path.join(svcPath, 'src', 'prisma', 'schema.prisma')
  if (!fs.existsSync(schemaPath)) {
    console.log(`[SKIP] ${svc} — no schema.prisma found`)
    continue
  }
  process.stdout.write(`[GEN]  ${svc} ... `)
  try {
    execSync(`${pnpmCmd} exec prisma generate --schema=${schemaPath}`, { cwd: svcPath, stdio: 'pipe', shell: true })
    console.log('OK')
    passed++
  } catch (err) {
    console.log('FAILED')
    errors.push({ svc, message: err.stderr?.toString() ?? err.message })
    failed++
  }
}

console.log(`\nDone: ${passed} generated, ${failed} failed`)
if (errors.length) {
  for (const e of errors) console.error(`\n[ERR] ${e.svc}:\n${e.message}`)
  process.exit(1)
}
