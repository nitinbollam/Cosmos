/**
 * Minimal seed: creates one tenant + one super admin user in auth-service DB,
 * plus demo KPI snapshots in analytics-service DB.
 * Run after `pnpm migrate:all`.
 *
 * USAGE:
 *   DATABASE_URL=postgresql://cosmos:cosmos@localhost:15432/cosmos pnpm seed
 */
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(__dirname, '..')
const authServiceDir = path.join(ROOT, 'services', 'auth-service')
const analyticsServiceDir = path.join(ROOT, 'services', 'analytics-service')
const inventoryServiceDir = path.join(ROOT, 'services', 'inventory-service')
const requireAuth = createRequire(path.join(authServiceDir, 'package.json'))
const requireAnalytics = createRequire(path.join(analyticsServiceDir, 'package.json'))
const requireInventory = createRequire(path.join(inventoryServiceDir, 'package.json'))
const bcrypt = requireAuth('bcrypt') as typeof import('bcrypt')

function serviceDatabaseUrl(serviceSlug: string): string {
  const base = process.env.DATABASE_URL ?? 'postgresql://cosmos:cosmos@localhost:15432/cosmos'
  if (base.includes(`cosmos_${serviceSlug}`)) return base
  return base.replace(/\/[^/?]+(\?.*)?$/, `/cosmos_${serviceSlug}$1`)
}

async function seedAuth() {
  process.env.DATABASE_URL = serviceDatabaseUrl('auth')

  const clientPath = path.join(authServiceDir, 'src', 'generated', 'prisma-client')
  const { PrismaClient } = requireAuth(clientPath) as typeof import('../services/auth-service/src/generated/prisma-client')

  const prisma = new PrismaClient()
  try {
    const tenant = await prisma.tenant.upsert({
      where: { slug: 'demo' },
      update: {},
      create: { name: 'Demo Tenant', slug: 'demo', plan: 'STARTER' },
    })

    const passwordHash = await bcrypt.hash('admin1234', 12)
    const admin = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: 'admin@cosmos.local' } },
      update: { passwordHash },
      create: {
        tenantId: tenant.id,
        email: 'admin@cosmos.local',
        passwordHash,
        firstName: 'Admin',
        lastName: 'Cosmos',
        role: 'SUPER_ADMIN',
      },
    })

    return { tenantId: tenant.id, adminId: admin.id }
  } finally {
    await prisma.$disconnect()
  }
}

async function seedDefaultWarehouse(tenantId: string) {
  process.env.DATABASE_URL = serviceDatabaseUrl('inventory')

  const clientPath = path.join(inventoryServiceDir, 'src', 'generated', 'prisma-client')
  const { PrismaClient } = requireInventory(clientPath) as typeof import('../services/inventory-service/src/generated/prisma-client')

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
  process.env.DATABASE_URL = serviceDatabaseUrl('analytics')

  const clientPath = path.join(analyticsServiceDir, 'src', 'generated', 'prisma-client')
  const { PrismaClient, Prisma } = requireAnalytics(clientPath) as typeof import('../services/analytics-service/src/generated/prisma-client')

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
  await seedDefaultWarehouse(tenantId)
  await seedAnalyticsKpis(tenantId)

  console.log(
    JSON.stringify(
      {
        tenantId,
        adminId,
        email: 'admin@cosmos.local',
        password: 'admin1234',
        defaultWarehouseCode: 'MAIN',
        kpiDays: 7,
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
