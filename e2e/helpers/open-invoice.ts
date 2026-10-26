import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'

const webRoot = path.resolve(__dirname, '..', '..', 'apps', 'web')
const requireWeb = createRequire(path.join(webRoot, 'package.json'))

/** A local database URL the dev server uses (apps/web/.env.local, written by prepare-dev-env). */
function databaseUrl(envKey: 'ORDER_DATABASE_URL' | 'CRM_DATABASE_URL'): string {
  if (process.env[envKey]) return process.env[envKey]!
  const envLocal = fs.readFileSync(path.join(webRoot, '.env.local'), 'utf8')
  const line = envLocal.split('\n').find((l) => l.trim().startsWith(`${envKey}=`))
  if (!line) throw new Error(`${envKey} is not set in apps/web/.env.local`)
  return line.slice(line.indexOf('=') + 1).trim()
}

type OrderClient = import('../../apps/web/generated/prisma-order').PrismaClient
type CrmClient = import('../../apps/web/generated/prisma-crm').PrismaClient

function clients() {
  const { PrismaClient: OrderPrisma } = requireWeb('./generated/prisma-order') as {
    PrismaClient: new (opts: { datasourceUrl: string }) => OrderClient
  }
  const { PrismaClient: CrmPrisma } = requireWeb('./generated/prisma-crm') as {
    PrismaClient: new (opts: { datasourceUrl: string }) => CrmClient
  }
  return {
    orders: new OrderPrisma({ datasourceUrl: databaseUrl('ORDER_DATABASE_URL') }),
    crm: new CrmPrisma({ datasourceUrl: databaseUrl('CRM_DATABASE_URL') }),
  }
}

export type OpenInvoiceIds = { orderId: string; invoiceId: string; customerId: string }

/**
 * An unpaid shipped NET_TERMS invoice in the seeded demo tenant, billed to a customer of its own
 * (with the invoice total as credit in use), so recording payments against it leaves the seeded
 * customers alone. The seed's own invoices are all paid. `remove()` deletes what was created.
 */
export async function createOpenInvoice(total: string) {
  const { orders, crm } = clients()
  const seeded = await orders.invoice.findFirstOrThrow({ where: { invoiceNumber: 'INV-ORD_SHIP' } })
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const customer = await crm.customer.create({
    data: {
      tenantId: seeded.tenantId,
      name: `Payment Test Co ${tag}`,
      email: `payment-test-${tag.toLowerCase()}@example.test`,
      creditUsed: total,
    },
  })
  const order = await orders.order.create({
    data: {
      tenantId: seeded.tenantId,
      customerId: customer.id,
      channel: 'B2B_PORTAL',
      totalAmount: total,
      paymentMethod: 'NET_TERMS',
      status: 'SHIPPED',
    },
  })
  const invoiceNumber = `INV-E2E${tag}`
  const invoice = await orders.invoice.create({
    data: {
      tenantId: seeded.tenantId,
      orderId: order.id,
      invoiceNumber,
      customerId: customer.id,
      subtotal: total,
      taxAmount: 0,
      totalAmount: total,
    },
  })
  const ids: OpenInvoiceIds = { orderId: order.id, invoiceId: invoice.id, customerId: customer.id }
  return {
    ...ids,
    invoiceNumber,
    customerName: customer.name,
    async amountPaid() {
      return (await orders.order.findUniqueOrThrow({ where: { id: order.id } })).amountPaid.toFixed(2)
    },
    async postingJobs() {
      return orders.postingJob.count({ where: { sourceId: invoice.id } })
    },
    async remove() {
      await removeOpenInvoice(ids)
      await disconnect()
    },
    async disconnect() {
      await disconnect()
    },
  }

  async function disconnect() {
    await orders.$disconnect()
    await crm.$disconnect()
  }
}

/**
 * Deletes a test invoice, its order, its queued posting jobs and its customer. Journal entries the
 * posting worker already wrote and notification log rows are left in place.
 */
export async function removeOpenInvoice(ids: OpenInvoiceIds) {
  const { orders, crm } = clients()
  try {
    await orders.postingJob.deleteMany({ where: { sourceId: ids.invoiceId } })
    await orders.invoice.deleteMany({ where: { id: ids.invoiceId } })
    await orders.order.deleteMany({ where: { id: ids.orderId } })
    await crm.customer.deleteMany({ where: { id: ids.customerId } })
  } finally {
    await orders.$disconnect()
    await crm.$disconnect()
  }
}
