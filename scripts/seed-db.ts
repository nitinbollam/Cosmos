/**
 * Minimal seed: creates one tenant + one super admin user in auth-service DB.
 * Run after `pnpm db:migrate`.
 *
 * USAGE:
 *   DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_auth pnpm tsx scripts/seed-db.ts
 */
import { execSync } from 'node:child_process'
import path from 'node:path'

const cwd = path.resolve(__dirname, '..', 'services', 'auth-service')

const code = `
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcrypt')

async function main() {
  const prisma = new PrismaClient()
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: 'Demo Tenant', slug: 'demo', plan: 'STARTER' },
  })
  const passwordHash = await bcrypt.hash('admin1234', 12)
  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@cosmos.local' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@cosmos.local',
      passwordHash,
      firstName: 'Admin',
      lastName: 'Cosmos',
      role: 'SUPER_ADMIN',
    },
  })
  console.log(JSON.stringify({ tenantId: tenant.id, adminId: admin.id, email: 'admin@cosmos.local', password: 'admin1234' }, null, 2))
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
`

execSync(`node -e "${code.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`, {
  cwd,
  stdio: 'inherit',
  env: { ...process.env },
})
