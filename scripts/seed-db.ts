/**
 * Seed demo tenant for @cosmos/web (auth + tenant + inventory + analytics DBs).
 * Run after `npm run db:migrate`.
 *
 *   npm run seed
 */
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(__dirname, '..')
const WEB = path.join(ROOT, 'apps/web')
const requireWeb = createRequire(path.join(WEB, 'package.json'))
const { sqliteDatabaseUrl } = createRequire(__filename)('./db-urls.mjs') as {
  sqliteDatabaseUrl: (dbName: string, dataDir?: string) => string
}
const bcrypt = requireWeb('bcrypt') as typeof import('bcrypt')

const DEMO_SLUG = 'demo'
const DEMO_EMAIL = 'admin@cosmos.local'
const DEMO_PASSWORD = 'admin1234'

function dbUrl(dbName: string): string {
  return sqliteDatabaseUrl(dbName, process.env.COSMOS_DATA_DIR ?? '.data')
}

async function seedAuth(): Promise<{ tenantId: string; adminId: string }> {
  process.env.AUTH_DATABASE_URL = dbUrl('cosmos_auth')
  const { PrismaClient } = requireWeb('./generated/prisma-auth') as typeof import('../apps/web/generated/prisma-auth')
  const prisma = new PrismaClient()
  try {
    const tenant = await prisma.tenant.upsert({
      where: { slug: DEMO_SLUG },
      update: {},
      create: { name: 'Demo Tenant', slug: DEMO_SLUG, plan: 'STARTER', settings: {} },
    })
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)
    const admin = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: DEMO_EMAIL } },
      update: { passwordHash, role: 'SUPER_ADMIN', isActive: true },
      create: {
        tenantId: tenant.id,
        email: DEMO_EMAIL,
        passwordHash,
        firstName: 'Admin',
        lastName: 'Cosmos',
        role: 'SUPER_ADMIN',
        permissions: [],
      },
    })
    return { tenantId: tenant.id, adminId: admin.id }
  } finally {
    await prisma.$disconnect()
  }
}

async function seedTenantOrg(tenantId: string) {
  process.env.TENANT_DATABASE_URL = dbUrl('cosmos_tenant')
  const { PrismaClient } = requireWeb('./generated/prisma-tenant') as typeof import('../apps/web/generated/prisma-tenant')
  const prisma = new PrismaClient()
  try {
    await prisma.tenantOrganization.upsert({
      where: { id: tenantId },
      update: { displayName: 'Demo Tenant', slug: DEMO_SLUG },
      create: {
        id: tenantId,
        slug: DEMO_SLUG,
        displayName: 'Demo Tenant',
        billingEmail: DEMO_EMAIL,
        settings: {},
        metadata: {},
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function seedDefaultWarehouse(tenantId: string) {
  process.env.INVENTORY_DATABASE_URL = dbUrl('cosmos_inventory')
  const { PrismaClient } = requireWeb('./generated/prisma-inventory') as typeof import('../apps/web/generated/prisma-inventory')
  const prisma = new PrismaClient()
  try {
    await prisma.warehouse.upsert({
      where: { tenantId_code: { tenantId, code: 'MAIN' } },
      update: { isDefault: true, isActive: true },
      create: {
        tenantId,
        name: 'Main Warehouse',
        code: 'MAIN',
        isDefault: true,
        address: {
          line1: '100 Distribution Way',
          city: 'Dallas',
          state: 'TX',
          postalCode: '75201',
          country: 'US',
        },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function seedAnalyticsKpis(tenantId: string) {
  process.env.ANALYTICS_DATABASE_URL = dbUrl('cosmos_analytics')
  const { PrismaClient, Prisma } = requireWeb('./generated/prisma-analytics') as typeof import('../apps/web/generated/prisma-analytics')
  const prisma = new PrismaClient()
  try {
    const today = new Date()
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
      const ordersCount = 12 + i * 2
      const revenue = 4200 + i * 350
      await prisma.dailyKpiSnapshot.upsert({
        where: { tenantId_date: { tenantId, date: d } },
        update: {
          ordersCount,
          revenue: new Prisma.Decimal(revenue),
          skusActive: 128,
        },
        create: {
          tenantId,
          date: d,
          ordersCount,
          revenue: new Prisma.Decimal(revenue),
          skusActive: 128,
        },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const { tenantId, adminId } = await seedAuth()
  await seedTenantOrg(tenantId)
  await seedDefaultWarehouse(tenantId)
  await seedAnalyticsKpis(tenantId)

  console.log(
    JSON.stringify(
      {
        tenantId,
        adminId,
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        defaultWarehouseCode: 'MAIN',
        kpiDays: 7,
        login: 'http://localhost:4000/admin/login',
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
