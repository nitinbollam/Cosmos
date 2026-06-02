import { crmDb, inventoryDb, orderDb, storefrontDb } from './db'

export async function globalSearch(tenantId: string, query: string, limit = 20) {
  const q = query.trim()
  if (q.length < 2) return { orders: [], customers: [], skus: [], quotes: [] }

  const [orders, customers, skus, quotes] = await Promise.all([
    orderDb.order.findMany({
      where: { tenantId, OR: [{ id: { contains: q } }, { notes: { contains: q } }] },
      select: { id: true, status: true, totalAmount: true, customerId: true, createdAt: true },
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    crmDb.customer.findMany({
      where: {
        tenantId,
        OR: [{ name: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }],
      },
      select: { id: true, name: true, email: true },
      take: limit,
    }),
    inventoryDb.sKU.findMany({
      where: {
        tenantId,
        OR: [{ code: { contains: q } }, { name: { contains: q } }, { barcode: { contains: q } }],
      },
      select: { id: true, code: true, name: true, price: true },
      take: limit,
    }),
    storefrontDb.b2BQuote.findMany({
      where: { tenantId, OR: [{ id: { contains: q } }, { notes: { contains: q } }] },
      select: { id: true, status: true, customerRef: true, createdAt: true },
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return { orders, customers, skus, quotes }
}
