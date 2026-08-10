/**
 * Count CRM customers, saved cards, and payment intents created under the OLD
 * platform-key Stripe namespace (before Connect cutover).
 *
 * Run: npx tsx scripts/stripe-connect-migration-audit.ts
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { DB_BY_SCHEMA, envKeyForSchema, sqliteDatabaseUrl } = require('./db-urls.mjs') as {
  DB_BY_SCHEMA: Record<string, string>
  envKeyForSchema: (name: string) => string
  sqliteDatabaseUrl: (dbName: string, dataDir?: string) => string
}

const dataDir = process.env.COSMOS_DATA_DIR ?? '.data'
for (const [schema, dbName] of Object.entries(DB_BY_SCHEMA)) {
  if (['crm', 'payment', 'tenant'].includes(schema)) {
    process.env[envKeyForSchema(schema)] = sqliteDatabaseUrl(dbName, dataDir)
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient: CrmClient } = require('../apps/web/generated/prisma-crm') as typeof import('../apps/web/generated/prisma-crm')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient: PaymentClient } = require('../apps/web/generated/prisma-payment') as typeof import('../apps/web/generated/prisma-payment')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient: TenantClient } = require('../apps/web/generated/prisma-tenant') as typeof import('../apps/web/generated/prisma-tenant')

async function main() {
  const crm = new CrmClient()
  const payment = new PaymentClient()
  const tenant = new TenantClient()

  try {
    const customersWithStripeId = await crm.customer.count({
      where: { stripeCustomerId: { not: null } },
    })
    const customersMissingConnectAccount = await crm.customer.count({
      where: {
        stripeCustomerId: { not: null },
        OR: [{ stripeConnectAccountId: null }, { stripeConnectAccountId: '' }],
      },
    })
    const customersWithConnectAccount = await crm.customer.count({
      where: {
        stripeCustomerId: { not: null },
        stripeConnectAccountId: { not: null },
      },
    })

    const savedCardsTotal = await payment.savedPaymentMethod.count()
    const savedCardsWithoutConnect = await payment.savedPaymentMethod.count({
      where: { OR: [{ stripeConnectedAccountId: null }, { stripeConnectedAccountId: '' }] },
    })

    const paymentIntentsWithStripe = await payment.paymentIntent.count({
      where: { stripeIntentId: { not: null } },
    })

    const tenantsWithConnect = await tenant.tenantOrganization.count({
      where: { stripeConnectedAccountId: { not: null } },
    })
    const tenantsTotal = await tenant.tenantOrganization.count()

    console.log('\n=== Stripe Connect migration audit ===\n')
    console.log('These records may have been created under the global platform key')
    console.log('and are NOT valid on connected accounts after cutover.\n')

    console.log('CRM customers with stripeCustomerId:', customersWithStripeId)
    console.log('  └ without stripeConnectAccountId (likely legacy):', customersMissingConnectAccount)
    console.log('  └ with stripeConnectAccountId set:', customersWithConnectAccount)

    console.log('\nSavedPaymentMethod rows (total):', savedCardsTotal)
    console.log('  └ without stripeConnectedAccountId (likely legacy):', savedCardsWithoutConnect)

    console.log('\nPaymentIntent rows with stripeIntentId:', paymentIntentsWithStripe)

    console.log('\nTenantOrganization with Connect account:', tenantsWithConnect, '/', tenantsTotal)

    console.log('\n--- Recommended cutover decision ---')
    console.log('Before enabling Connect in production, decide whether to:')
    console.log('  1) Clear stripeCustomerId + delete saved cards for affected tenants, OR')
    console.log('  2) Leave legacy rows but block charging until customers re-save cards on Connect')
    console.log('\nNo automatic migration was performed.\n')
  } finally {
    await crm.$disconnect()
    await payment.$disconnect()
    await tenant.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
