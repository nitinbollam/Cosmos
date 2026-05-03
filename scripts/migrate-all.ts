/**
 * Run prisma migrate deploy across every service that has its own schema.
 * Each service owns its own logical database (DB url suffixed with service name).
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const SERVICES_WITH_SCHEMA = [
  'auth-service',
  'tenant-service',
  'inventory-service',
  'wms-service',
  'order-service',
  'purchasing-service',
  'compliance-service',
  'storefront-service',
  'pos-service',
  'crm-service',
  'dispatch-service',
  'payment-service',
  'ledger-service',
  'analytics-service',
  'notification-service',
]

const ROOT = path.resolve(__dirname, '..')
const baseUrl = process.env.DATABASE_URL ?? 'postgresql://cosmos:cosmos@localhost:5432'

for (const svc of SERVICES_WITH_SCHEMA) {
  const cwd = path.join(ROOT, 'services', svc)
  const schema = path.join(cwd, 'src', 'prisma', 'schema.prisma')
  if (!existsSync(schema)) {
    console.log(`[skip] ${svc}: no schema`)
    continue
  }
  const dbName = `cosmos_${svc.replace('-service', '').replace('-', '_')}`
  const url = baseUrl.includes('?')
    ? baseUrl.replace(/\?/, `_${dbName}?`)
    : (baseUrl.replace(/\/[^\/]*$/, `/${dbName}`) || `${baseUrl}/${dbName}`)

  console.log(`\n[migrate] ${svc} -> ${url.replace(/:[^:@]*@/, ':***@')}`)
  execSync('npx prisma migrate deploy --schema=src/prisma/schema.prisma', {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  })
}

console.log('\nAll migrations complete.')
