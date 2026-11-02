import { Prisma, QuoteStatus } from '@/generated/prisma-storefront'
import { storefrontDb } from './db'
import { ApiError } from './session'
import * as crm from './crm'
import * as inv from './inventory'
import * as orders from './orders'

export async function listQuotes(tenantId: string, status?: string, opts?: { buyerCustomerId?: string }) {
  const st = status as QuoteStatus | undefined
  const rows = await storefrontDb.b2BQuote.findMany({
    where: {
      tenantId,
      ...(st ? { status: st } : {}),
      ...(opts?.buyerCustomerId ? { customerRef: opts.buyerCustomerId } : {}),
    },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })
  const customerIds = [...new Set(rows.map((r) => r.customerRef))]
  const { crmDb } = await import('./db')
  const customers =
    customerIds.length > 0
      ? await crmDb.customer.findMany({ where: { tenantId, id: { in: customerIds } } })
      : []
  const custMap = new Map(customers.map((c) => [c.id, c.name]))

  return rows.map((r) => ({
    ...r,
    customerName: custMap.get(r.customerRef) ?? r.customerRef,
    quoteNumber: `Q-${r.id.slice(-8).toUpperCase()}`,
  }))
}

export async function getQuote(tenantId: string, id: string, opts?: { buyerCustomerId?: string }) {
  const row = await storefrontDb.b2BQuote.findFirst({
    where: { id, tenantId },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  })
  if (!row) throw new ApiError(404, 'Quote not found')
  if (opts?.buyerCustomerId && row.customerRef !== opts.buyerCustomerId) {
    throw new ApiError(404, 'Quote not found')
  }
  const { crmDb } = await import('./db')
  const cust = await crmDb.customer.findFirst({ where: { tenantId, id: row.customerRef } })
  return {
    ...row,
    customerName: cust?.name ?? row.customerRef,
    quoteNumber: `Q-${row.id.slice(-8).toUpperCase()}`,
  }
}

export async function createQuote(
  tenantId: string,
  dto: { customerRef: string; notes?: string; lines: Array<{ lineNo: number; skuCode?: string; description: string; qty: number; unitPrice: number }> },
  opts?: { buyerCustomerId?: string },
) {
  if (opts?.buyerCustomerId && dto.customerRef !== opts.buyerCustomerId) {
    throw new ApiError(403, 'Cannot create quotes for another customer')
  }
  if (!Array.isArray(dto.lines) || dto.lines.length === 0) throw new ApiError(400, 'A quote needs at least one line')
  const seqs = new Set(dto.lines.map((l) => l.lineNo))
  if (seqs.size !== dto.lines.length) throw new ApiError(400, 'Duplicate line numbers')
  await resolveQuoteCustomerId(tenantId, dto.customerRef)
  // Every line names a real product up front, so an approved quote can always become an order (ticket 55).
  const lines = []
  for (const l of dto.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new ApiError(400, `Line ${l.lineNo}: quantity must be a whole number of 1 or more`)
    if (typeof l.unitPrice !== 'number' || !Number.isFinite(l.unitPrice) || l.unitPrice < 0) {
      throw new ApiError(400, `Line ${l.lineNo}: unit price must be 0 or more`)
    }
    const sku = await quoteLineSku(tenantId, l.lineNo, l.skuCode)
    lines.push({
      lineNo: l.lineNo,
      skuCode: sku.code,
      description: l.description?.trim() || sku.name,
      qty: l.qty,
      unitPrice: new Prisma.Decimal(String(l.unitPrice)),
    })
  }
  return storefrontDb.b2BQuote.create({
    data: {
      tenantId,
      customerRef: dto.customerRef,
      notes: dto.notes,
      status: QuoteStatus.OPEN,
      lines: { create: lines },
    },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  })
}

export async function requestQuoteApproval(
  tenantId: string,
  id: string,
  opts?: { buyerCustomerId?: string },
) {
  const q = await getQuote(tenantId, id, opts)
  if (q.status !== QuoteStatus.OPEN && q.status !== QuoteStatus.REJECTED) {
    throw new ApiError(400, `Cannot request approval from status ${q.status}`)
  }
  return storefrontDb.b2BQuote.update({
    where: { id },
    data: { status: QuoteStatus.PENDING_APPROVAL, rejectionReason: null },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  })
}

/** The active SKU a quote line is for; a line without one can't become an order. */
async function quoteLineSku(tenantId: string, lineNo: number, skuCode: string | null | undefined) {
  const code = skuCode?.trim()
  if (!code) throw new ApiError(400, `Line ${lineNo}: choose a product (SKU)`)
  const { inventoryDb } = await import('./db')
  const sku = await inventoryDb.sKU.findFirst({ where: { tenantId, code: { equals: code } } })
  if (!sku) throw new ApiError(400, `Line ${lineNo}: no product with SKU ${code}`)
  if (!sku.isActive) throw new ApiError(400, `Line ${lineNo}: product ${code} is inactive`)
  return sku
}

/** The customer a quote is for: its customerRef is a customer id, or (older quotes) a customer's external reference. */
async function resolveQuoteCustomerId(tenantId: string, customerRef: string): Promise<string> {
  const ref = customerRef?.trim()
  if (!ref) throw new ApiError(400, 'A quote needs a customer')
  const { crmDb } = await import('./db')
  const byId = await crmDb.customer.findFirst({ where: { tenantId, id: ref }, select: { id: true } })
  if (byId) return byId.id
  const byRef = await crm.findCustomerByExternalRef(tenantId, ref)
  if (byRef) return byRef.id
  throw new ApiError(400, `No customer matches the quote's customer (${ref})`)
}

export async function approveQuote(tenantId: string, id: string, approvedByUserId: string) {
  const q = await getQuote(tenantId, id)
  if (q.status !== QuoteStatus.PENDING_APPROVAL) {
    throw new ApiError(400, 'Only pending quotes can be approved')
  }
  // A quote that couldn't become an order must not be approvable (ticket 55).
  try {
    await resolveQuoteCustomerId(tenantId, q.customerRef)
    for (const line of q.lines) await quoteLineSku(tenantId, line.lineNo, line.skuCode)
  } catch (e) {
    if (e instanceof ApiError) throw new ApiError(400, `This quote can't be approved yet. ${e.message}`)
    throw e
  }
  return storefrontDb.b2BQuote.update({
    where: { id },
    data: {
      status: QuoteStatus.APPROVED,
      approvedAt: new Date(),
      approvedByUserId,
      rejectionReason: null,
    },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  })
}

export async function rejectQuote(tenantId: string, id: string, reason: string) {
  const q = await getQuote(tenantId, id)
  if (q.status !== QuoteStatus.PENDING_APPROVAL) {
    throw new ApiError(400, 'Only pending quotes can be rejected')
  }
  if (!reason?.trim()) throw new ApiError(400, 'reason is required')
  return storefrontDb.b2BQuote.update({
    where: { id },
    data: { status: QuoteStatus.REJECTED, rejectionReason: reason.trim() },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  })
}

async function quoteToOrderLines(tenantId: string, q: Awaited<ReturnType<typeof getQuote>>) {
  const warehouses = await inv.listWarehouses(tenantId)
  if (warehouses.length === 0) {
    throw new ApiError(400, 'No warehouses found — create a warehouse before submitting quotes.')
  }
  const defaultWh = warehouses.find((w) => w.isDefault) ?? warehouses[0]
  const lineItems: Array<{ skuId: string; warehouseId: string; quantity: number; unitPrice: number }> = []
  for (const line of [...q.lines].sort((a, b) => a.lineNo - b.lineNo)) {
    const sku = await quoteLineSku(tenantId, line.lineNo, line.skuCode)
    lineItems.push({
      skuId: sku.id,
      warehouseId: defaultWh.id,
      quantity: line.qty,
      unitPrice: Number(line.unitPrice),
    })
  }
  return lineItems
}

/**
 * Turns an approved quote into an order at the approved prices, placed by the buyer (their own quote) or by
 * staff ("Create order from quote"). The quote's customer is the order's customer; the approval is what
 * authorises its prices, so they are not checked against the price list again (ticket 55).
 */
export async function submitQuote(
  tenantId: string,
  id: string,
  opts?: { buyerCustomerId?: string; userId?: string },
) {
  const q = await getQuote(tenantId, id, opts)
  if (q.convertedOrderId) return getQuote(tenantId, id, opts)
  if (q.status !== QuoteStatus.APPROVED) {
    throw new ApiError(400, 'Quote must be approved before placing an order')
  }

  const customerId = opts?.buyerCustomerId ?? (await resolveQuoteCustomerId(tenantId, q.customerRef))
  const lineItems = await quoteToOrderLines(tenantId, q)

  // Claim the quote first so two clicks (or buyer and staff at once) can't both create an order.
  const claimed = await storefrontDb.b2BQuote.updateMany({
    where: { id, tenantId, status: QuoteStatus.APPROVED, convertedOrderId: null },
    data: { status: QuoteStatus.SUBMITTED },
  })
  if (claimed.count !== 1) {
    const now = await getQuote(tenantId, id, opts)
    if (now.convertedOrderId || now.status === QuoteStatus.SUBMITTED) return now
    throw new ApiError(409, 'The quote changed while placing the order; reload and try again')
  }

  let order
  try {
    order = await orders.createOrder(
      tenantId,
      {
        customerId,
        channel: opts?.buyerCustomerId ? 'B2B_PORTAL' : 'SALES_REP',
        paymentMethod: 'NET_TERMS',
        notes: q.notes ?? `From quote ${q.quoteNumber}`,
        lineItems,
      },
      {
        ...(opts?.buyerCustomerId ? { buyerCustomerId: opts.buyerCustomerId } : {}),
        userId: opts?.userId,
        skipPriceValidation: true,
      },
    )
  } catch (e) {
    // Nothing was ordered: put the quote back so it can be placed once the problem (stock, credit) is fixed.
    await storefrontDb.b2BQuote.updateMany({
      where: { id, tenantId, status: QuoteStatus.SUBMITTED, convertedOrderId: null },
      data: { status: QuoteStatus.APPROVED },
    })
    throw e
  }

  return storefrontDb.b2BQuote.update({
    where: { id },
    data: { convertedOrderId: order.id },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  })
}

export async function listQuoteCounterOffers(tenantId: string, quoteId: string) {
  await getQuote(tenantId, quoteId)
  return storefrontDb.quoteCounterOffer.findMany({
    where: { quoteId },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createQuoteCounterOffer(
  tenantId: string,
  quoteId: string,
  dto: {
    offeredBy: 'BUYER' | 'ADMIN'
    userId?: string
    notes?: string
    lines: Array<{ lineNo: number; qty: number; unitPrice: number }>
  },
  opts?: { buyerCustomerId?: string },
) {
  const q = await getQuote(tenantId, quoteId, opts)
  if (!['OPEN', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(q.status)) {
    throw new ApiError(400, 'Cannot counter-offer on this quote')
  }
  if (dto.lines.length === 0) throw new ApiError(400, 'At least one line required')

  return storefrontDb.quoteCounterOffer.create({
    data: {
      quoteId,
      offeredBy: dto.offeredBy,
      userId: dto.userId,
      notes: dto.notes,
      lines: {
        create: dto.lines.map((l) => ({
          lineNo: l.lineNo,
          qty: l.qty,
          unitPrice: new Prisma.Decimal(l.unitPrice),
        })),
      },
    },
    include: { lines: true },
  })
}

export async function acceptQuoteCounterOffer(tenantId: string, quoteId: string, counterOfferId: string) {
  const offer = await storefrontDb.quoteCounterOffer.findFirst({
    where: { id: counterOfferId, quoteId },
    include: { lines: true },
  })
  if (!offer) throw new ApiError(404, 'Counter offer not found')
  if (offer.status !== 'OPEN') throw new ApiError(400, 'Counter offer is not open')

  // Keep each line's product and description: the offer only changes quantities and prices.
  const before = await getQuote(tenantId, quoteId)
  const prior = new Map(before.lines.map((l) => [l.lineNo, l]))
  await storefrontDb.quoteLine.deleteMany({ where: { quoteId } })
  await storefrontDb.b2BQuote.update({
    where: { id: quoteId },
    data: {
      status: QuoteStatus.OPEN,
      lines: {
        create: offer.lines.map((l) => ({
          lineNo: l.lineNo,
          skuCode: prior.get(l.lineNo)?.skuCode ?? null,
          description: prior.get(l.lineNo)?.description ?? `Line ${l.lineNo}`,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
      },
    },
  })
  await storefrontDb.quoteCounterOffer.update({ where: { id: counterOfferId }, data: { status: 'ACCEPTED' } })
  return getQuote(tenantId, quoteId)
}
