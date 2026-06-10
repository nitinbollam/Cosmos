/**
 * Seed demo data across all Cosmos domains (14 SQLite DBs).
 * Idempotent — safe to re-run: npm run seed
 *
 *   npm run db:migrate && npm run seed
 */
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(__dirname, '..')
const WEB = path.join(ROOT, 'apps/web')
const requireWeb = createRequire(path.join(WEB, 'package.json'))
const { sqliteDatabaseUrl, DB_BY_SCHEMA } = createRequire(__filename)('./db-urls.mjs') as {
  sqliteDatabaseUrl: (dbName: string, dataDir?: string) => string
  DB_BY_SCHEMA: Record<string, string>
}
const bcrypt = requireWeb('bcrypt') as typeof import('bcrypt')

const DEMO_SLUG = 'demo'
const ADMIN_EMAIL = 'admin@cosmos.local'
const ADMIN_PASSWORD = 'admin1234'
const BUYER_EMAIL = 'buyer@acme-retail.com'
const BUYER_PASSWORD = 'buyer1234'

/** Stable IDs so cross-DB references stay consistent across re-seeds. */
const ID = {
  whMain: 'seed_wh_main',
  whEast: 'seed_wh_east',
  skuVapePod: 'seed_sku_vape_pod',
  skuVapeMod: 'seed_sku_vape_mod',
  skuEnergy: 'seed_sku_energy',
  skuSnack: 'seed_sku_snack',
  skuLowStock: 'seed_sku_low_stock',
  skuAccessory: 'seed_sku_accessory',
  customerAcme: 'seed_cust_acme',
  customerBeta: 'seed_cust_beta',
  customerWalkIn: 'seed_cust_walkin',
  leadCorner: 'seed_lead_corner',
  supplierPacific: 'seed_sup_pacific',
  po1001: 'seed_po_1001',
  quoteOpen: 'seed_quote_open',
  quotePending: 'seed_quote_pending',
  orderPending: 'seed_ord_pending',
  orderProcessing: 'seed_ord_processing',
  orderShipped: 'seed_ord_shipped',
  orderDelivered: 'seed_ord_delivered',
  invoiceShipped: 'seed_inv_shipped',
  invoiceDelivered: 'seed_inv_delivered',
  fulfillProcessing: 'seed_ff_processing',
  fulfillShipped: 'seed_ff_shipped',
  receiveSession: 'seed_recv_open',
  cycleCount: 'seed_cycle_draft',
  cycleCountPending: 'seed_cycle_pending',
  routeToday: 'seed_route_today',
  msaTenant: 'seed_msa_tenant',
  msaReport: 'seed_msa_report',
  journalEntry: 'seed_je_001',
  acctCash: 'seed_acct_cash',
  acctAr: 'seed_acct_ar',
  acctRev: 'seed_acct_rev',
  acctInv: 'seed_acct_inv',
  acctAp: 'seed_acct_ap',
  acctCogs: 'seed_acct_cogs',
  vendorBill: 'seed_bill_1001',
  bankAccount: 'seed_bank_main',
  posRegister: 'seed_pos_1',
  orderTemplate: 'seed_tpl_acme',
  binA1: 'seed_bin_a1',
  volumeBreak: 'seed_vol_break',
  shipmentShipped: 'seed_ship_shipped_1',
  shipmentDelivered1: 'seed_ship_delivered_1',
  shipmentDelivered2: 'seed_ship_delivered_2',
  auditOrderShipped: 'seed_audit_ship',
  auditPayment: 'seed_audit_pay',
  pickWaveDemo: 'seed_pick_wave_1',
  paymentIntent: 'seed_pay_intent',
  notifLowStock: 'seed_notif_lowstock',
} as const

type SeedCtx = {
  tenantId: string
  adminId: string
  driverId: string
  warehouseId: string
  warehouseEastId: string
  skuIds: Record<string, string>
  customerAcmeId: string
  orderProcessingId: string
  orderShippedId: string
}

function dbUrl(dbName: string): string {
  return sqliteDatabaseUrl(dbName, process.env.COSMOS_DATA_DIR ?? '.data')
}

function loadPrisma<T>(envVar: string, dbName: string, relImport: string): T {
  process.env[envVar] = dbUrl(dbName)
  return requireWeb(relImport) as T
}

const NO_BATCH = ''

async function seedAuth(): Promise<{ tenantId: string; adminId: string; driverId: string }> {
  const { PrismaClient } = loadPrisma<{ PrismaClient: new () => import('../apps/web/generated/prisma-auth').PrismaClient }>(
    'AUTH_DATABASE_URL',
    'cosmos_auth',
    './generated/prisma-auth',
  )
  const prisma = new PrismaClient()
  const hash = (pw: string) => bcrypt.hash(pw, 12)
  try {
    const tenant = await prisma.tenant.upsert({
      where: { slug: DEMO_SLUG },
      update: { name: 'Cosmos Demo Distributors', plan: 'GROWTH', isActive: true },
      create: { name: 'Cosmos Demo Distributors', slug: DEMO_SLUG, plan: 'GROWTH', settings: {} },
    })

    const users = [
      { email: ADMIN_EMAIL, firstName: 'Admin', lastName: 'Cosmos', role: 'SUPER_ADMIN' as const, password: ADMIN_PASSWORD },
      { email: BUYER_EMAIL, firstName: 'Alex', lastName: 'Buyer', role: 'STAFF' as const, password: BUYER_PASSWORD },
      { email: 'driver@cosmos.local', firstName: 'Dan', lastName: 'Driver', role: 'DRIVER' as const, password: 'driver1234' },
      { email: 'warehouse@cosmos.local', firstName: 'Wendy', lastName: 'Warehouse', role: 'WAREHOUSE_STAFF' as const, password: 'warehouse1234' },
      { email: 'sales@cosmos.local', firstName: 'Sam', lastName: 'Sales', role: 'SALES_REP' as const, password: 'sales1234' },
    ]

    const ids: Record<string, string> = {}
    for (const u of users) {
      const row = await prisma.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
        update: {
          passwordHash: await hash(u.password),
          role: u.role,
          isActive: true,
          firstName: u.firstName,
          lastName: u.lastName,
          emailVerifiedAt: new Date(),
        },
        create: {
          tenantId: tenant.id,
          email: u.email,
          passwordHash: await hash(u.password),
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          permissions: [],
          emailVerifiedAt: new Date(),
        },
      })
      ids[u.email] = row.id
    }

    return { tenantId: tenant.id, adminId: ids[ADMIN_EMAIL], driverId: ids['driver@cosmos.local'] }
  } finally {
    await prisma.$disconnect()
  }
}

async function seedTenantOrg(tenantId: string) {
  const { PrismaClient } = loadPrisma<{ PrismaClient: new () => import('../apps/web/generated/prisma-tenant').PrismaClient }>(
    'TENANT_DATABASE_URL',
    'cosmos_tenant',
    './generated/prisma-tenant',
  )
  const prisma = new PrismaClient()
  try {
    await prisma.tenantOrganization.upsert({
      where: { id: tenantId },
      update: {
        displayName: 'Cosmos Demo Distributors',
        slug: DEMO_SLUG,
        plan: 'GROWTH',
        industry: 'GENERAL_WHOLESALE',
        billingEmail: ADMIN_EMAIL,
        timeZone: 'America/Chicago',
        onboardingPhase: 'READY',
        settings: { currency: 'USD', salesTaxRate: 0.07 },
      },
      create: {
        id: tenantId,
        slug: DEMO_SLUG,
        displayName: 'Cosmos Demo Distributors',
        plan: 'GROWTH',
        industry: 'GENERAL_WHOLESALE',
        billingEmail: ADMIN_EMAIL,
        timeZone: 'America/Chicago',
        onboardingPhase: 'READY',
        settings: { currency: 'USD', salesTaxRate: 0.07 },
        metadata: { seeded: true },
      },
    })

    for (const stepKey of ['ORG_PROFILE', 'BILLING_CONTACT', 'FIRST_WAREHOUSE', 'COMPLIANCE_ACK']) {
      await prisma.tenantOnboardingStep.upsert({
        where: { tenantId_stepKey: { tenantId, stepKey } },
        update: { completed: true, completedAt: new Date() },
        create: { tenantId, stepKey, completed: true, completedAt: new Date(), payload: {} },
      })
    }

    await prisma.tenantInvite.upsert({
      where: { id: 'seed_invite_accountant' },
      update: { email: 'accountant@example.com', role: 'ACCOUNTANT', expiresAt: new Date(Date.now() + 7 * 864e5) },
      create: {
        id: 'seed_invite_accountant',
        tenantId,
        email: 'accountant@example.com',
        role: 'ACCOUNTANT',
        expiresAt: new Date(Date.now() + 7 * 864e5),
      },
    })

    await prisma.webhookSubscription.upsert({
      where: { id: 'seed_webhook_orders' },
      update: { active: true },
      create: {
        id: 'seed_webhook_orders',
        tenantId,
        event: 'order.confirmed',
        url: 'https://example.com/webhooks/cosmos/orders',
        description: 'Demo order webhook',
        active: true,
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function seedInventory(tenantId: string): Promise<{ warehouseId: string; warehouseEastId: string; skuIds: Record<string, string> }> {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-inventory')>(
    'INVENTORY_DATABASE_URL',
    'cosmos_inventory',
    './generated/prisma-inventory',
  )
  const prisma = new mod.PrismaClient()
  const D = mod.Prisma.Decimal
  try {
    await prisma.warehouse.upsert({
      where: { tenantId_code: { tenantId, code: 'MAIN' } },
      update: { id: ID.whMain, isDefault: true, isActive: true },
      create: {
        id: ID.whMain,
        tenantId,
        name: 'Main Warehouse — Dallas',
        code: 'MAIN',
        isDefault: true,
        address: { line1: '100 Distribution Way', city: 'Dallas', state: 'TX', postalCode: '75201', country: 'US' },
      },
    })
    await prisma.warehouse.upsert({
      where: { tenantId_code: { tenantId, code: 'EAST' } },
      update: { id: ID.whEast, isActive: true },
      create: {
        id: ID.whEast,
        tenantId,
        name: 'East Coast DC — Newark',
        code: 'EAST',
        isDefault: false,
        address: { line1: '50 Port Terminal Blvd', city: 'Newark', state: 'NJ', postalCode: '07114', country: 'US' },
      },
    })

    await prisma.binLocation.upsert({
      where: { tenantId_warehouseId_code: { tenantId, warehouseId: ID.whMain, code: 'A-01-01' } },
      update: { id: ID.binA1, isActive: true },
      create: { id: ID.binA1, tenantId, warehouseId: ID.whMain, code: 'A-01-01', aisle: 'A', zone: 'PICK' },
    })

    const skus = [
      { id: ID.skuVapePod, code: 'VAP-POD-001', name: 'Premium Widget 5pk', category: 'General Merchandise', price: 24.99, cost: 12.5, qty: 420, reorder: 50 },
      { id: ID.skuVapeMod, code: 'VAP-MOD-010', name: 'Pro Tool Kit', category: 'Tools & Equipment', price: 89.99, cost: 45, qty: 85, reorder: 20 },
      { id: ID.skuEnergy, code: 'BEV-ENG-200', name: 'Energy Drink Case (24)', category: 'Beverages', price: 36, cost: 22, qty: 200, reorder: 40 },
      { id: ID.skuSnack, code: 'SNK-CHP-050', name: 'Spicy Chips Box', category: 'Snacks', price: 18.5, cost: 9, qty: 310, reorder: 60 },
      { id: ID.skuLowStock, code: 'ACC-CBL-USB', name: 'USB-C Cable 3ft', category: 'Accessories', price: 8.99, cost: 3.2, qty: 8, reorder: 25 },
      { id: ID.skuAccessory, code: 'ACC-STAND-01', name: 'Display Stand', category: 'Accessories', price: 45, cost: 18, qty: 64, reorder: 10 },
    ] as const

    const skuIds: Record<string, string> = {}
    for (const s of skus) {
      await prisma.sKU.upsert({
        where: { tenantId_code: { tenantId, code: s.code } },
        update: {
          id: s.id,
          name: s.name,
          price: new D(s.price),
          cost: new D(s.cost),
          isActive: true,
          isTobacco: false,
        },
        create: {
          id: s.id,
          tenantId,
          code: s.code,
          name: s.name,
          description: `Demo SKU — ${s.name}`,
          category: s.category,
          cost: new D(s.cost),
          price: new D(s.price),
          isTobacco: false,
          imageUrls: [],
          attributes: { demo: true },
        },
      })
      skuIds[s.id] = s.id

      await prisma.stockLevel.upsert({
        where: {
          tenantId_skuId_warehouseId_batchId: { tenantId, skuId: s.id, warehouseId: ID.whMain, batchId: NO_BATCH },
        },
        update: {
          quantityOnHand: s.qty,
          quantityAvailable: s.qty,
          quantityReserved: 0,
          reorderPoint: s.reorder,
          reorderQty: s.reorder * 2,
          locationId:
            s.id === ID.skuVapePod || s.id === ID.skuEnergy || s.id === ID.skuSnack ? ID.binA1 : null,
        },
        create: {
          tenantId,
          skuId: s.id,
          warehouseId: ID.whMain,
          batchId: NO_BATCH,
          quantityOnHand: s.qty,
          quantityAvailable: s.qty,
          quantityReserved: 0,
          reorderPoint: s.reorder,
          reorderQty: s.reorder * 2,
          locationId:
            s.id === ID.skuVapePod || s.id === ID.skuEnergy || s.id === ID.skuSnack ? ID.binA1 : null,
        },
      })
    }

    return { warehouseId: ID.whMain, warehouseEastId: ID.whEast, skuIds }
  } finally {
    await prisma.$disconnect()
  }
}

async function seedCrm(tenantId: string, adminId: string) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-crm')>('CRM_DATABASE_URL', 'cosmos_crm', './generated/prisma-crm')
  const prisma = new mod.PrismaClient()
  const D = mod.Prisma.Decimal
  try {
    await prisma.customer.upsert({
      where: { id: ID.customerAcme },
      update: { name: 'Acme Retail Group', email: BUYER_EMAIL, phone: '+1-214-555-0101', creditLimit: new D(50000), paymentTermsDays: 30 },
      create: {
        id: ID.customerAcme,
        tenantId,
        name: 'Acme Retail Group',
        email: BUYER_EMAIL,
        phone: '+1-214-555-0101',
        customerKind: 'BUSINESS',
        creditLimit: new D(50000),
        creditUsed: new D(1250),
        paymentTermsDays: 30,
        salesRepUserId: adminId,
        primaryAddressLine1: '500 Commerce St',
        primaryCity: 'Fort Worth',
        primaryState: 'TX',
        primaryZip: '76102',
      },
    })

    await prisma.customer.upsert({
      where: { id: ID.customerBeta },
      update: {},
      create: {
        id: ID.customerBeta,
        tenantId,
        name: 'Beta Convenience LLC',
        email: 'orders@betasmoke.example',
        phone: '+1-972-555-0199',
        customerKind: 'BUSINESS',
        creditLimit: new D(15000),
        paymentTermsDays: 15,
        primaryAddressLine1: '88 Main St',
        primaryCity: 'Plano',
        primaryState: 'TX',
        primaryZip: '75024',
      },
    })

    await prisma.customer.upsert({
      where: { id: ID.customerWalkIn },
      update: { name: 'Walk-in Customer' },
      create: {
        id: ID.customerWalkIn,
        tenantId,
        name: 'Walk-in Customer',
        email: 'walkin@cosmos.local',
        customerKind: 'INDIVIDUAL',
        creditLimit: new D(0),
        paymentTermsDays: 0,
      },
    })

    await prisma.lead.upsert({
      where: { id: ID.leadCorner },
      update: { status: 'QUALIFIED' },
      create: {
        id: ID.leadCorner,
        tenantId,
        companyName: 'Corner Store Collective',
        contactName: 'Maria Lopez',
        email: 'maria@cornerstore.example',
        status: 'QUALIFIED',
        source: 'TRADE_SHOW',
        pipelineValue: new D(8000),
        assignedToUserId: adminId,
      },
    })

    await prisma.activity.deleteMany({ where: { tenantId, id: { in: ['seed_act_call_acme'] } } })
    await prisma.activity.create({
      data: {
        id: 'seed_act_call_acme',
        tenantId,
        type: 'CALL',
        subject: 'Quarterly reorder check-in',
        body: 'Acme confirmed interest in expanding their seasonal product line.',
        outcome: 'POSITIVE',
        customerId: ID.customerAcme,
        occurredAt: new Date(Date.now() - 2 * 864e5),
      },
    })

    await prisma.customerPrice.upsert({
      where: { tenantId_customerId_skuId: { tenantId, customerId: ID.customerAcme, skuId: ID.skuVapePod } },
      update: { unitPrice: new D(22.5) },
      create: {
        tenantId,
        customerId: ID.customerAcme,
        skuId: ID.skuVapePod,
        unitPrice: new D(22.5),
        notes: 'Annual contract — 10% off list',
      },
    })

    await prisma.customerPrice.upsert({
      where: { tenantId_customerId_skuId: { tenantId, customerId: ID.customerAcme, skuId: ID.skuEnergy } },
      update: { unitPrice: new D(31.5) },
      create: {
        tenantId,
        customerId: ID.customerAcme,
        skuId: ID.skuEnergy,
        unitPrice: new D(31.5),
        notes: 'Volume tier pricing',
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function seedOrders(tenantId: string, ctx: Pick<SeedCtx, 'customerAcmeId' | 'warehouseId' | 'skuIds' | 'adminId'>) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-order')>('ORDER_DATABASE_URL', 'cosmos_order', './generated/prisma-order')
  const prisma = new mod.PrismaClient()
  const D = mod.Prisma.Decimal

  const specs = [
    { id: ID.orderPending, status: 'PENDING' as const, total: 249.9, paid: 0, daysAgo: 0, channel: 'B2B_PORTAL' as const, lines: [{ sku: ID.skuVapeMod, qty: 2, price: 89.99 }, { sku: ID.skuAccessory, qty: 1, price: 45 }] },
    { id: ID.orderProcessing, status: 'PROCESSING' as const, total: 174.93, paid: 174.93, daysAgo: 1, channel: 'B2B_PORTAL' as const, lines: [{ sku: ID.skuVapePod, qty: 5, price: 24.99 }, { sku: ID.skuEnergy, qty: 2, price: 36 }] },
    { id: ID.orderShipped, status: 'SHIPPED' as const, total: 72, paid: 72, daysAgo: 3, channel: 'SALES_REP' as const, lines: [{ sku: ID.skuEnergy, qty: 2, price: 36 }] },
    { id: ID.orderDelivered, status: 'DELIVERED' as const, total: 124.95, paid: 124.95, daysAgo: 7, channel: 'B2B_PORTAL' as const, lines: [{ sku: ID.skuVapePod, qty: 5, price: 24.99 }] },
  ]

  const orderCreatedAt = (daysAgo: number) => {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo, 15, 0, 0))
  }

  try {
    for (const o of specs) {
      const existing = await prisma.order.findUnique({ where: { id: o.id } })
      if (existing) {
        await prisma.order.update({
          where: { id: o.id },
          data: {
            status: o.status,
            totalAmount: new D(o.total),
            amountPaid: new D(o.paid),
            paymentMethod: o.paid > 0 ? 'CARD' : 'NET_TERMS',
            createdAt: orderCreatedAt(o.daysAgo),
          },
        })
        continue
      }
      await prisma.order.create({
        data: {
          id: o.id,
          tenantId,
          customerId: ctx.customerAcmeId,
          channel: o.channel,
          status: o.status,
          totalAmount: new D(o.total),
          amountPaid: new D(o.paid),
          taxAmount: new D(0),
          paymentMethod: o.paid > 0 ? 'CARD' : 'NET_TERMS',
          salesRepId: ctx.adminId,
          createdAt: orderCreatedAt(o.daysAgo),
          shippingAddress: { line1: '500 Commerce St', city: 'Fort Worth', state: 'TX', postalCode: '76102' },
          lineItems: {
            create: o.lines.map((l, i) => ({
              id: `${o.id}_line_${i}`,
              skuId: l.sku,
              warehouseId: ctx.warehouseId,
              quantity: l.qty,
              unitPrice: new D(l.price),
            })),
          },
        },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function seedOrderShipments(tenantId: string, ctx: Pick<SeedCtx, 'warehouseId' | 'skuIds'>) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-order')>(
    'ORDER_DATABASE_URL',
    'cosmos_order',
    './generated/prisma-order',
  )
  const prisma = new mod.PrismaClient()
  const { ShipmentStatus } = mod
  try {
    await prisma.orderShipment.deleteMany({ where: { tenantId, orderId: { in: [ID.orderShipped, ID.orderDelivered] } } })

    await prisma.orderShipment.create({
      data: {
        id: ID.shipmentShipped,
        tenantId,
        orderId: ID.orderShipped,
        shipmentNo: 1,
        status: ShipmentStatus.SHIPPED,
        carrier: 'UPS',
        trackingNumber: '1Z999AA10123456784',
        shippedAt: new Date(Date.now() - 864e5 * 2),
        lineItems: [{ skuId: ID.skuEnergy, warehouseId: ctx.warehouseId, quantity: 2 }],
      },
    })

    await prisma.orderShipment.createMany({
      data: [
        {
          id: ID.shipmentDelivered1,
          tenantId,
          orderId: ID.orderDelivered,
          shipmentNo: 1,
          status: ShipmentStatus.DELIVERED,
          carrier: 'FedEx',
          trackingNumber: '794612345678',
          shippedAt: new Date(Date.now() - 864e5 * 6),
          lineItems: [{ skuId: ID.skuVapePod, warehouseId: ctx.warehouseId, quantity: 3 }],
        },
        {
          id: ID.shipmentDelivered2,
          tenantId,
          orderId: ID.orderDelivered,
          shipmentNo: 2,
          status: ShipmentStatus.DELIVERED,
          carrier: 'UPS',
          trackingNumber: '1Z999AA10987654321',
          shippedAt: new Date(Date.now() - 864e5 * 5),
          lineItems: [{ skuId: ID.skuVapePod, warehouseId: ctx.warehouseId, quantity: 2 }],
        },
      ],
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function seedAuditEvents(tenantId: string, adminId: string) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-tenant')>(
    'TENANT_DATABASE_URL',
    'cosmos_tenant',
    './generated/prisma-tenant',
  )
  const prisma = new mod.PrismaClient()
  try {
    for (const row of [
      {
        id: ID.auditOrderShipped,
        tenantId,
        userId: adminId,
        action: 'order.shipped',
        entityType: 'Order',
        entityId: ID.orderShipped,
        metadata: { carrier: 'UPS' },
      },
      {
        id: ID.auditPayment,
        tenantId,
        userId: adminId,
        action: 'payment.received',
        entityType: 'Invoice',
        entityId: ID.invoiceDelivered,
        metadata: { amount: 124.95 },
      },
    ]) {
      await prisma.auditEvent.upsert({
        where: { id: row.id },
        update: {},
        create: row,
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function seedInvoices(tenantId: string, customerAcmeId: string) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-order')>('ORDER_DATABASE_URL', 'cosmos_order', './generated/prisma-order')
  const prisma = new mod.PrismaClient()
  const D = mod.Prisma.Decimal
  const specs = [
    {
      id: ID.invoiceShipped,
      orderId: ID.orderShipped,
      invoiceNumber: 'INV-ORD_SHIP',
      total: 72,
      paid: 72,
      status: 'PAID' as const,
      daysAgo: 3,
    },
    {
      id: ID.invoiceDelivered,
      orderId: ID.orderDelivered,
      invoiceNumber: 'INV-ORD_DELV',
      total: 124.95,
      paid: 124.95,
      status: 'PAID' as const,
      daysAgo: 7,
    },
  ]

  try {
    for (const inv of specs) {
      const issuedAt = new Date(Date.now() - inv.daysAgo * 864e5)
      const dueAt = new Date(issuedAt)
      dueAt.setDate(dueAt.getDate() + 30)
      await prisma.invoice.upsert({
        where: { orderId: inv.orderId },
        update: {
          status: inv.status,
          amountPaid: new D(inv.paid),
          totalAmount: new D(inv.total),
        },
        create: {
          id: inv.id,
          tenantId,
          orderId: inv.orderId,
          invoiceNumber: inv.invoiceNumber,
          customerId: customerAcmeId,
          status: inv.status,
          subtotal: new D(inv.total),
          taxAmount: new D(0),
          totalAmount: new D(inv.total),
          amountPaid: new D(inv.paid),
          issuedAt,
          dueAt,
        },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function seedQuotes(tenantId: string) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-storefront')>(
    'STOREFRONT_DATABASE_URL',
    'cosmos_storefront',
    './generated/prisma-storefront',
  )
  const prisma = new mod.PrismaClient()
  const D = mod.Prisma.Decimal
  try {
    await prisma.b2BQuote.upsert({
      where: { id: ID.quoteOpen },
      update: { status: 'OPEN' },
      create: {
        id: ID.quoteOpen,
        tenantId,
        customerRef: ID.customerAcme,
        status: 'OPEN',
        notes: 'Demo quote — submit for approval from buyer portal',
        lines: {
          create: [
            { id: 'seed_quote_line_1', lineNo: 1, skuCode: 'VAP-POD-001', description: 'Premium Widget 5pk', qty: 20, unitPrice: new D(22.5) },
            { id: 'seed_quote_line_2', lineNo: 2, skuCode: 'BEV-ENG-200', description: 'Energy Drink Case', qty: 10, unitPrice: new D(34) },
          ],
        },
      },
    })

    await prisma.b2BQuote.upsert({
      where: { id: ID.quotePending },
      update: { status: 'PENDING_APPROVAL' },
      create: {
        id: ID.quotePending,
        tenantId,
        customerRef: ID.customerAcme,
        status: 'PENDING_APPROVAL',
        notes: 'Awaiting admin approval — review at /admin/quotes',
        lines: {
          create: [
            { id: 'seed_quote_pending_1', lineNo: 1, skuCode: 'SNK-CHP-050', description: 'Spicy Chips Box', qty: 50, unitPrice: new D(17) },
          ],
        },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function seedPurchasing(tenantId: string) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-purchasing')>(
    'PURCHASING_DATABASE_URL',
    'cosmos_purchasing',
    './generated/prisma-purchasing',
  )
  const prisma = new mod.PrismaClient()
  const D = mod.Prisma.Decimal
  try {
    await prisma.supplier.upsert({
      where: { tenantId_code: { tenantId, code: 'PAC-VAP' } },
      update: { id: ID.supplierPacific, name: 'Pacific Supply Co.' },
      create: { id: ID.supplierPacific, tenantId, code: 'PAC-VAP', name: 'Pacific Supply Co.', email: 'orders@pacificsupply.example', phone: '+1-503-555-0142' },
    })

    await prisma.purchaseOrder.upsert({
      where: { tenantId_number: { tenantId, number: 'PO-1001' } },
      update: { status: 'SUBMITTED' },
      create: {
        id: ID.po1001,
        tenantId,
        supplierId: ID.supplierPacific,
        number: 'PO-1001',
        status: 'SUBMITTED',
        notes: 'Restock widgets — receive at /m/warehouse/receiving',
        lines: {
          create: [
            { id: 'seed_po_line_1', lineNo: 1, skuCode: 'VAP-POD-001', description: 'Premium Widget 5pk', qtyOrdered: 200, qtyReceived: 50, unitCost: new D(11.5) },
            { id: 'seed_po_line_2', lineNo: 2, skuCode: 'VAP-MOD-010', description: 'Pro Tool Kit', qtyOrdered: 40, qtyReceived: 0, unitCost: new D(42) },
          ],
        },
      },
    })

    await prisma.vendorBill.upsert({
      where: { tenantId_billNumber: { tenantId, billNumber: 'BILL-1001-1' } },
      update: {
        status: 'ISSUED',
        matchStatus: 'MATCHED',
        matchNotes: null,
        poTotal: new D(2300),
        receivedTotal: new D(575),
      },
      create: {
        id: ID.vendorBill,
        tenantId,
        supplierId: ID.supplierPacific,
        purchaseOrderId: ID.po1001,
        billNumber: 'BILL-1001-1',
        status: 'ISSUED',
        subtotal: new D(575),
        taxAmount: new D(0),
        totalAmount: new D(575),
        amountPaid: new D(0),
        dueAt: new Date(Date.now() + 30 * 864e5),
        notes: 'Partial receipt — 50 units VAP-POD-001',
        lines: {
          create: [
            { id: 'seed_bill_line_1', lineNo: 1, skuCode: 'VAP-POD-001', description: 'Premium Widget 5pk', quantity: 50, unitCost: new D(11.5) },
          ],
        },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function seedWms(tenantId: string, ctx: Pick<SeedCtx, 'warehouseId' | 'adminId' | 'orderProcessingId' | 'orderShippedId'>) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-wms')>('WMS_DATABASE_URL', 'cosmos_wms', './generated/prisma-wms')
  const prisma = new mod.PrismaClient()
  try {
    await prisma.fulfillmentTask.upsert({
      where: { tenantId_orderId: { tenantId, orderId: ctx.orderProcessingId } },
      update: { status: 'PICKING', assignedUserId: ctx.adminId },
      create: {
        id: ID.fulfillProcessing,
        tenantId,
        orderId: ctx.orderProcessingId,
        status: 'PICKING',
        priority: 'HIGH',
        correlationId: 'seed-corr-ff-1',
        warehouseId: ctx.warehouseId,
        warehouseCode: 'MAIN',
        assignedUserId: ctx.adminId,
        pickLines: {
          create: [
            { id: 'seed_pick_1', skuId: ID.skuVapePod, warehouseId: ctx.warehouseId, quantity: 5, pickedQty: 3, status: 'PENDING' },
            { id: 'seed_pick_2', skuId: ID.skuEnergy, warehouseId: ctx.warehouseId, quantity: 2, pickedQty: 2, status: 'PICKED' },
          ],
        },
      },
    })

    await prisma.fulfillmentTask.upsert({
      where: { tenantId_orderId: { tenantId, orderId: ctx.orderShippedId } },
      update: { status: 'DISPATCHED' },
      create: {
        id: ID.fulfillShipped,
        tenantId,
        orderId: ctx.orderShippedId,
        status: 'DISPATCHED',
        correlationId: 'seed-corr-ff-2',
        warehouseId: ctx.warehouseId,
        warehouseCode: 'MAIN',
        pickLines: {
          create: [{ id: 'seed_pick_3', skuId: ID.skuEnergy, warehouseId: ctx.warehouseId, quantity: 2, pickedQty: 2, status: 'PICKED' }],
        },
        cartons: {
          create: {
            id: 'seed_carton_1',
            tenantId,
            cartonNumber: 1,
            weightGrams: 12000,
            carrier: 'Cosmos Freight',
            trackingNum: 'CFX-DEMO-001',
            sealedAt: new Date(),
            items: { create: [{ id: 'seed_carton_item_1', skuId: ID.skuEnergy, quantity: 2 }] },
          },
        },
      },
    })

    await prisma.pickWave.upsert({
      where: { id: ID.pickWaveDemo },
      update: { status: 'IN_PROGRESS' },
      create: {
        id: ID.pickWaveDemo,
        tenantId,
        warehouseId: ctx.warehouseId,
        status: 'IN_PROGRESS',
        createdBy: ctx.adminId,
        tasks: {
          create: [{ taskId: ID.fulfillProcessing }],
        },
      },
    })

    await prisma.receivingSession.upsert({
      where: { id: ID.receiveSession },
      update: { status: 'OPEN' },
      create: {
        id: ID.receiveSession,
        tenantId,
        warehouseId: ctx.warehouseId,
        poId: ID.po1001,
        status: 'OPEN',
        startedBy: ctx.adminId,
        items: {
          create: [
            { id: 'seed_recv_item_1', skuId: ID.skuVapePod, expectedQty: 200, receivedQty: 0, scannedBy: ctx.adminId, purchaseOrderLineId: 'seed_po_line_1' },
            { id: 'seed_recv_item_2', skuId: ID.skuVapeMod, expectedQty: 40, receivedQty: 0, scannedBy: ctx.adminId, purchaseOrderLineId: 'seed_po_line_2' },
          ],
        },
      },
    })

    await prisma.cycleCount.upsert({
      where: { id: ID.cycleCount },
      update: { status: 'IN_PROGRESS' },
      create: {
        id: ID.cycleCount,
        tenantId,
        warehouseId: ctx.warehouseId,
        type: 'ABC',
        status: 'IN_PROGRESS',
        scheduledFor: new Date(Date.now() + 864e5),
        createdBy: ctx.adminId,
        lines: {
          create: [
            { id: 'seed_cc_line_1', skuId: ID.skuLowStock, locationLabel: 'A-01-02', systemQty: 8, countedQty: null },
            { id: 'seed_cc_line_2', skuId: ID.skuAccessory, locationLabel: 'B-02-01', systemQty: 64, countedQty: null },
          ],
        },
      },
    })

    await prisma.cycleCount.upsert({
      where: { id: ID.cycleCountPending },
      update: { status: 'PENDING_APPROVAL' },
      create: {
        id: ID.cycleCountPending,
        tenantId,
        warehouseId: ctx.warehouseId,
        type: 'RANDOM',
        status: 'PENDING_APPROVAL',
        createdBy: ctx.adminId,
        lines: {
          create: [
            { id: 'seed_cc_pending_1', skuId: ID.skuLowStock, locationLabel: 'A-01-02', systemQty: 8, countedQty: 10 },
            { id: 'seed_cc_pending_2', skuId: ID.skuAccessory, locationLabel: 'B-02-01', systemQty: 64, countedQty: 64 },
          ],
        },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function seedDispatch(tenantId: string, driverId: string) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-dispatch')>(
    'DISPATCH_DATABASE_URL',
    'cosmos_dispatch',
    './generated/prisma-dispatch',
  )
  const prisma = new mod.PrismaClient()
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  try {
    await prisma.deliveryRoute.upsert({
      where: { id: ID.routeToday },
      update: { driverId, status: 'IN_PROGRESS', lastKnownLat: 32.7767, lastKnownLng: -96.797, lastKnownAt: new Date() },
      create: {
        id: ID.routeToday,
        tenantId,
        driverId,
        name: 'Dallas Metro — Route A',
        status: 'IN_PROGRESS',
        scheduledFor: today,
        lastKnownLat: 32.7767,
        lastKnownLng: -96.797,
        lastKnownAt: new Date(),
        stops: {
          create: [
            {
              id: 'seed_stop_1',
              sequence: 1,
              status: 'DELIVERED',
              address: { line1: '500 Commerce St', city: 'Fort Worth', state: 'TX', postalCode: '76102', customer: 'Acme Retail' },
            },
            {
              id: 'seed_stop_2',
              sequence: 2,
              status: 'EN_ROUTE',
              address: {
                line1: '88 Main St',
                city: 'Plano',
                state: 'TX',
                postalCode: '75024',
                customer: 'Beta Smoke Shop',
                orderId: ID.orderShipped,
              },
            },
            {
              id: 'seed_stop_3',
              sequence: 3,
              status: 'PENDING',
              address: { line1: '1200 Market St', city: 'Dallas', state: 'TX', postalCode: '75202', customer: 'Downtown Vape' },
            },
          ],
        },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function seedCompliance(tenantId: string) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-compliance')>(
    'COMPLIANCE_DATABASE_URL',
    'cosmos_compliance',
    './generated/prisma-compliance',
  )
  const prisma = new mod.PrismaClient()
  const D = mod.Prisma.Decimal
  const weekEnd = new Date()
  weekEnd.setUTCHours(0, 0, 0, 0)
  const weekStart = new Date(weekEnd.getTime() - 6 * 864e5)
  try {
    const msaRow = await prisma.mSATenant.upsert({
      where: { tenantId },
      update: { reporterDid: 'did:cosmos:demo-reporter', msaEnabled: true },
      create: {
        id: ID.msaTenant,
        tenantId,
        reporterDid: 'did:cosmos:demo-reporter',
        msaEnabled: true,
      },
    })
    await prisma.mSAManufacturerDid.upsert({
      where: { msaTenantId_manufacturerDid: { msaTenantId: msaRow.id, manufacturerDid: 'did:cosmos:demo-mfg' } },
      update: { manufacturerName: 'Demo Manufacturer Co', isActive: true },
      create: {
        id: 'seed_msa_mfg_1',
        msaTenantId: msaRow.id,
        reporterDid: 'did:cosmos:demo-reporter',
        manufacturerDid: 'did:cosmos:demo-mfg',
        manufacturerName: 'Demo Manufacturer Co',
        ediEndpoint: 'https://edi.example.com/msa',
        autoSubmit: false,
        ediCredentials: {},
      },
    })

    for (const tx of [
      { id: 'seed_msa_tx_1', orderId: ID.orderDelivered, upc: '012345678905', qty: 50, cartons: 10, net: 1250 },
      { id: 'seed_msa_tx_2', orderId: ID.orderShipped, upc: '012345678912', qty: 20, cartons: 4, net: 480 },
    ]) {
      await prisma.mSATransaction.upsert({
        where: { id: tx.id },
        update: {},
        create: {
          id: tx.id,
          tenantId,
          manufacturerDid: 'did:cosmos:demo-mfg',
          upcCode: tx.upc,
          transactionDate: new Date(),
          quantityPurchased: tx.qty,
          cartonCount: tx.cartons,
          netAmount: new D(tx.net),
          orderId: tx.orderId,
          isQualifying: true,
        },
      })
    }

    await prisma.mSAReport.upsert({
      where: { id: ID.msaReport },
      update: { status: 'GENERATED' },
      create: {
        id: ID.msaReport,
        tenantId,
        reporterDid: 'did:cosmos:demo-reporter',
        manufacturerDid: 'did:cosmos:demo-mfg',
        weekStart,
        weekEnding: weekEnd,
        filePath: '/demo/msa-report.xml',
        fileHash: 'demo-hash',
        totalTransactions: 2,
        netPurchases: new D(1730),
        status: 'GENERATED',
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function seedLedger(tenantId: string) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-ledger')>('LEDGER_DATABASE_URL', 'cosmos_ledger', './generated/prisma-ledger')
  const prisma = new mod.PrismaClient()
  const D = mod.Prisma.Decimal
  try {
    for (const [id, code, name, type] of [
      [ID.acctCash, '1000', 'Cash', 'ASSET'],
      [ID.acctAr, '1200', 'Accounts Receivable', 'ASSET'],
      [ID.acctInv, '1100', 'Inventory', 'ASSET'],
      [ID.acctAp, '2100', 'Accounts Payable', 'LIABILITY'],
      [ID.acctRev, '4000', 'Sales Revenue', 'REVENUE'],
      [ID.acctCogs, '5000', 'Cost of Goods Sold', 'EXPENSE'],
    ] as const) {
      await prisma.chartAccount.upsert({
        where: { tenantId_code: { tenantId, code } },
        update: { id },
        create: { id, tenantId, code, name, type },
      })
    }

    await prisma.journalEntry.upsert({
      where: { id: ID.journalEntry },
      update: { isPosted: true },
      create: {
        id: ID.journalEntry,
        tenantId,
        description: 'Demo sale — Acme Retail order',
        isPosted: true,
        postedAt: new Date(Date.now() - 864e5),
        lines: {
          create: [
            { id: 'seed_jl_1', accountId: ID.acctCash, debit: new D(124.95), credit: new D(0), memo: 'Card payment' },
            { id: 'seed_jl_2', accountId: ID.acctRev, debit: new D(0), credit: new D(124.95), memo: 'Revenue recognition' },
          ],
        },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function seedTier8Extras(ctx: SeedCtx) {
  const { tenantId, customerAcmeId, skuIds, warehouseId } = ctx

  const crmMod = loadPrisma<typeof import('../apps/web/generated/prisma-crm')>('CRM_DATABASE_URL', 'cosmos_crm', './generated/prisma-crm')
  const crm = new crmMod.PrismaClient()
  try {
    await crm.volumePriceBreak.upsert({
      where: { id: ID.volumeBreak },
      update: {},
      create: {
        id: ID.volumeBreak,
        tenantId,
        customerId: customerAcmeId,
        skuId: ID.skuVapePod,
        minQty: 10,
        unitPrice: new crmMod.Prisma.Decimal(8.99),
      },
    })
  } finally {
    await crm.$disconnect()
  }

  const sfMod = loadPrisma<typeof import('../apps/web/generated/prisma-storefront')>('STOREFRONT_DATABASE_URL', 'cosmos_storefront', './generated/prisma-storefront')
  const sf = new sfMod.PrismaClient()
  try {
    await sf.orderTemplate.upsert({
      where: { id: ID.orderTemplate },
      update: {},
      create: {
        id: ID.orderTemplate,
        tenantId,
        customerRef: customerAcmeId,
        name: 'Weekly restock',
        lines: {
          create: [
            { skuId: ID.skuVapePod, quantity: 12 },
            { skuId: ID.skuEnergy, quantity: 6 },
          ],
        },
      },
    })
  } finally {
    await sf.$disconnect()
  }

  const invMod = loadPrisma<typeof import('../apps/web/generated/prisma-inventory')>('INVENTORY_DATABASE_URL', 'cosmos_inventory', './generated/prisma-inventory')
  const inv = new invMod.PrismaClient()
  try {
    await inv.binLocation.upsert({
      where: { tenantId_warehouseId_code: { tenantId, warehouseId, code: 'A-01-01' } },
      update: { id: ID.binA1 },
      create: { id: ID.binA1, tenantId, warehouseId, code: 'A-01-01', aisle: 'A', zone: 'PICK' },
    })
  } finally {
    await inv.$disconnect()
  }

  const ledgerMod = loadPrisma<typeof import('../apps/web/generated/prisma-ledger')>('LEDGER_DATABASE_URL', 'cosmos_ledger', './generated/prisma-ledger')
  const ledger = new ledgerMod.PrismaClient()
  try {
    await ledger.bankAccount.upsert({
      where: { id: ID.bankAccount },
      update: {},
      create: {
        id: ID.bankAccount,
        tenantId,
        name: 'Operating Checking',
        accountNumber: '****4521',
        currentBalance: new ledgerMod.Prisma.Decimal(42500),
      },
    })
    await ledger.bankStatementLine.createMany({
      data: [
        {
          tenantId,
          bankAccountId: ID.bankAccount,
          postedAt: new Date(Date.now() - 864e5 * 2),
          description: 'ACH deposit — Acme Retail',
          amount: new ledgerMod.Prisma.Decimal(1250),
          reference: 'DEP-001',
        },
        {
          tenantId,
          bankAccountId: ID.bankAccount,
          postedAt: new Date(Date.now() - 864e5),
          description: 'Vendor payment — Pacific Supply',
          amount: new ledgerMod.Prisma.Decimal(-575),
          reference: 'CHK-8842',
        },
      ],
      skipDuplicates: true,
    }).catch(() => undefined)
  } finally {
    await ledger.$disconnect()
  }

  const tenantMod = loadPrisma<typeof import('../apps/web/generated/prisma-tenant')>('TENANT_DATABASE_URL', 'cosmos_tenant', './generated/prisma-tenant')
  const tenant = new tenantMod.PrismaClient()
  try {
    await tenant.posRegister.upsert({
      where: { id: ID.posRegister },
      update: {},
      create: { id: ID.posRegister, tenantId, name: 'Front Counter', warehouseId },
    })
  } finally {
    await tenant.$disconnect()
  }
}

async function seedPayments(tenantId: string) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-payment')>('PAYMENT_DATABASE_URL', 'cosmos_payment', './generated/prisma-payment')
  const prisma = new mod.PrismaClient()
  const D = mod.Prisma.Decimal
  try {
    await prisma.paymentIntent.upsert({
      where: { id: ID.paymentIntent },
      update: { status: 'CAPTURED' },
      create: {
        id: ID.paymentIntent,
        tenantId,
        orderId: ID.orderDelivered,
        amount: new D(124.95),
        paymentMethod: 'CARD',
        status: 'CAPTURED',
        customerId: ID.customerAcme,
        capturedAmount: new D(124.95),
        correlationId: 'seed-pay-1',
        metadata: { demo: true },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function seedNotifications(tenantId: string) {
  const mod = loadPrisma<typeof import('../apps/web/generated/prisma-notification')>(
    'NOTIFICATION_DATABASE_URL',
    'cosmos_notification',
    './generated/prisma-notification',
  )
  const prisma = new mod.PrismaClient()
  const buyerRows = [
    {
      id: 'seed_notif_buyer_order',
      idempotencyKey: 'seed-buyer-order-created',
      templateKey: 'order.created',
      payload: { orderId: ID.orderProcessing, total: '248.50', customerName: 'Acme Retail Group' },
    },
    {
      id: 'seed_notif_buyer_shipped',
      idempotencyKey: 'seed-buyer-order-shipped',
      templateKey: 'order.shipped',
      payload: { orderId: ID.orderShipped, customerName: 'Acme Retail Group' },
    },
    {
      id: 'seed_notif_buyer_invoice',
      idempotencyKey: 'seed-buyer-invoice',
      templateKey: 'invoice.issued',
      payload: {
        invoiceId: ID.invoiceShipped,
        orderId: ID.orderShipped,
        invoiceNumber: 'INV-10042',
        total: '312.00',
        dueAt: '2026-06-15',
        customerName: 'Acme Retail Group',
      },
    },
    {
      id: 'seed_notif_buyer_payment',
      idempotencyKey: 'seed-buyer-payment',
      templateKey: 'payment.received',
      payload: { orderId: ID.orderDelivered, amount: '124.95', invoiceNumber: 'INV-10043', customerName: 'Acme Retail Group' },
    },
  ] as const
  try {
    await prisma.notificationRequest.upsert({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: 'seed-low-stock' } },
      update: { status: 'SENT' },
      create: {
        id: ID.notifLowStock,
        tenantId,
        idempotencyKey: 'seed-low-stock',
        channel: 'EMAIL',
        recipient: ADMIN_EMAIL,
        templateKey: 'inventory.low_stock',
        payload: { skuCode: 'ACC-CBL-USB', qtyOnHand: 8, reorderPoint: 25 },
        status: 'SENT',
      },
    })
    for (const row of buyerRows) {
      await prisma.notificationRequest.upsert({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: row.idempotencyKey } },
        update: { status: 'SENT' },
        create: {
          id: row.id,
          tenantId,
          idempotencyKey: row.idempotencyKey,
          channel: 'EMAIL',
          recipient: BUYER_EMAIL,
          templateKey: row.templateKey,
          payload: row.payload,
          status: 'SENT',
        },
      })
    }
    await prisma.notificationRequest.upsert({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: 'seed-buyer-failed' } },
      update: { status: 'FAILED', errorMessage: 'Demo delivery failure — tap Retry in buyer inbox' },
      create: {
        id: 'seed_notif_buyer_failed',
        tenantId,
        idempotencyKey: 'seed-buyer-failed',
        channel: 'EMAIL',
        recipient: BUYER_EMAIL,
        templateKey: 'order.shipped',
        payload: { orderId: ID.orderShipped, customerName: 'Acme Retail Group' },
        status: 'FAILED',
        errorMessage: 'Demo delivery failure — tap Retry in buyer inbox',
      },
    })
    await prisma.notificationRequest.upsert({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: 'seed-buyer-sms' } },
      update: { status: 'SENT' },
      create: {
        id: 'seed_notif_buyer_sms',
        tenantId,
        idempotencyKey: 'seed-buyer-sms',
        channel: 'SMS',
        recipient: '+1-214-555-0101',
        templateKey: 'order.shipped',
        payload: { orderId: ID.orderShipped, customerName: 'Acme Retail Group' },
        status: 'SENT',
      },
    })
  } finally {
    await prisma.$disconnect()
  }

  const tenantMod = loadPrisma<typeof import('../apps/web/generated/prisma-tenant')>(
    'TENANT_DATABASE_URL',
    'cosmos_tenant',
    './generated/prisma-tenant',
  )
  const tenant = new tenantMod.PrismaClient()
  try {
    const org = await tenant.tenantOrganization.findUnique({ where: { id: tenantId } })
    if (org) {
      const settings = {
        ...((org.settings as Record<string, unknown>) ?? {}),
        customerNotificationPrefs: {
          [ID.customerAcme]: {
            emailEnabled: true,
            smsEnabled: true,
            orderUpdates: true,
            invoiceAlerts: true,
          },
        },
      }
      await tenant.tenantOrganization.update({ where: { id: tenantId }, data: { settings } })
    }
  } finally {
    await tenant.$disconnect()
  }
}

async function bootstrapWebEnv() {
  const dataDir = process.env.COSMOS_DATA_DIR ?? '.data'
  for (const [schema, dbName] of Object.entries(DB_BY_SCHEMA)) {
    const key = `${schema.toUpperCase()}_DATABASE_URL`
    if (!process.env[key]) process.env[key] = sqliteDatabaseUrl(dbName, dataDir)
  }
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'dev-seed-jwt-secret-min-32-chars-long'
}

async function main() {
  await bootstrapWebEnv()
  const { tenantId, adminId, driverId } = await seedAuth()
  await seedTenantOrg(tenantId)
  const { warehouseId, warehouseEastId, skuIds } = await seedInventory(tenantId)
  await seedCrm(tenantId, adminId)

  const ctx: SeedCtx = {
    tenantId,
    adminId,
    driverId,
    warehouseId,
    warehouseEastId,
    skuIds,
    customerAcmeId: ID.customerAcme,
    orderProcessingId: ID.orderProcessing,
    orderShippedId: ID.orderShipped,
  }

  await seedOrders(tenantId, ctx)
  await seedOrderShipments(tenantId, ctx)
  await seedInvoices(tenantId, ID.customerAcme)
  await seedQuotes(tenantId)
  await seedPurchasing(tenantId)
  await seedWms(tenantId, ctx)
  await seedDispatch(tenantId, driverId)
  await seedCompliance(tenantId)
  await seedLedger(tenantId)
  await seedTier8Extras(ctx)
  await seedAuditEvents(tenantId, adminId)
  await seedPayments(tenantId)
  await seedNotifications(tenantId)

  await import('../apps/web/server/register-paths.mjs')
  const { syncSnapshotsFromOrders } = await import('../apps/web/lib/server/analytics.ts')
  await syncSnapshotsFromOrders(tenantId, 30)

  const summary = {
    tenantId,
    login: {
      admin: { url: 'http://localhost:4000/admin/login', email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      buyer: { url: 'http://localhost:4000/login', email: BUYER_EMAIL, password: BUYER_PASSWORD, note: 'Links to Acme Retail customer for B2B shop' },
      driver: { email: 'driver@cosmos.local', password: 'driver1234', mobile: 'http://localhost:4000/m/delivery' },
      warehouse: { email: 'warehouse@cosmos.local', password: 'warehouse1234', mobile: 'http://localhost:4000/m/warehouse' },
    },
    scenarios: {
      dashboard: 'http://localhost:4000/admin — KPIs, cashflow, low-stock alert (ACC-CBL-USB)',
      catalog: 'http://localhost:4000/catalog — 6 SKUs with stock',
      orders: { pending: ID.orderPending, processing: ID.orderProcessing, shipped: ID.orderShipped, delivered: ID.orderDelivered },
      quote: `http://localhost:4000/quotes/${ID.quoteOpen}`,
      fulfillment: `http://localhost:4000/admin/fulfillment/${ID.fulfillProcessing}`,
      dispatch: `http://localhost:4000/admin/dispatch?route=${ID.routeToday}`,
      purchasing: `http://localhost:4000/admin/purchasing/${ID.po1001}`,
      receiving: 'http://localhost:4000/m/warehouse/receiving',
      compliance: `http://localhost:4000/admin/compliance/msa/${ID.msaReport}`,
      finance: `http://localhost:4000/admin/finance/journals/${ID.journalEntry}`,
      crm: `http://localhost:4000/admin/crm/customers/${ID.customerAcme}`,
    },
  }

  console.log('[seed] Demo data ready:\n')
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
