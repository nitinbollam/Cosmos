/**
 * Wraps `prisma generate` for every service that has a schema, then re-builds
 * @cosmos/types so consumers get the latest exports.
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

const services = [
  'auth-service',
  'inventory-service',
  'wms-service',
  'order-service',
  'compliance-service',
  'payment-service',
]

for (const svc of services) {
  const schema = path.join(ROOT, 'services', svc, 'src', 'prisma', 'schema.prisma')
  if (!existsSync(schema)) {
    console.log(`[skip] ${svc}: no schema`)
    continue
  }
  console.log(`[generate] ${svc}`)
  execSync('node ../../scripts/prisma-generate-retry.mjs src/prisma/schema.prisma', {
    cwd: path.join(ROOT, 'services', svc),
    stdio: 'inherit',
  })
}

console.log('[build] @cosmos/types')
execSync('npm run build -w @cosmos/types', { cwd: ROOT, stdio: 'inherit' })
console.log('Done.')
