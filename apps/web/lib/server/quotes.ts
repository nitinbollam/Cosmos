import { Prisma, QuoteStatus } from '@/generated/prisma-storefront'
import { storefrontDb } from './db'
import { ApiError } from './session'
import * as crm from './crm'
import * as inv from './inventory'
import * as orders from './orders'

export function listQuotes(tenantId: string, status?: string, opts?: { buyerCustomerId?: string }) {
  const st = status as QuoteStatus | undefined
  return storefrontDb.b2BQuote.findMany({
    where: {
      tenantId,
      ...(st ? { status: st } : {}),
      ...(opts?.buyerCustomerId ? { customerRef: opts.buyerCustomerId } : {}),
    },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })
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
  return row
}

export async function createQuote(
  tenantId: string,
  dto: { customerRef: string; notes?: string; lines: Array<{ lineNo: number; skuCode?: string; description: string; qty: number; unitPrice: number }> },
  opts?: { buyerCustomerId?: string },
) {
  if (opts?.buyerCustomerId && dto.customerRef !== opts.buyerCustomerId) {
    throw new ApiError(403, 'Cannot create quotes for another customer')
  }
  const seqs = new Set(dto.lines.map((l) => l.lineNo))
  if (seqs.size !== dto.lines.length) throw new ApiError(400, 'Duplicate line numbers')
  return storefrontDb.b2BQuote.create({
    data: {
      tenantId,
      customerRef: dto.customerRef,
      notes: dto.notes,
      status: QuoteStatus.OPEN,
      lines: {
        create: dto.lines.map((l) => ({
          lineNo: l.lineNo,
          skuCode: l.skuCode,
          description: l.description,
          qty: l.qty,
          unitPrice: new Prisma.Decimal(l.unitPrice),
        })),
      },
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

export async function approveQuote(tenantId: string, id: string, approvedByUserId: string) {
  const q = await getQuote(tenantId, id)
  if (q.status !== QuoteStatus.PENDING_APPROVAL) {
    throw new ApiError(400, 'Only pending quotes can be approved')
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
    const skuCode = line.skuCode?.trim()
    if (!skuCode) throw new ApiError(400, `Quote line ${line.lineNo}: skuCode is required`)
    const sku = await inv.findSkuByCode(tenantId, skuCode)
    lineItems.push({
      skuId: sku.id,
      warehouseId: defaultWh.id,
      quantity: line.qty,
      unitPrice: Number(line.unitPrice),
    })
  }
  return lineItems
}

export async function submitQuote(
  tenantId: string,
  id: string,
  sessionCustomerId?: string,
  opts?: { buyerCustomerId?: string },
) {
  const q = await getQuote(tenantId, id, opts)
  if (q.convertedOrderId) return getQuote(tenantId, id, opts)
  if (q.status !== QuoteStatus.APPROVED) {
    throw new ApiError(400, 'Quote must be approved before placing an order')
  }

  let customerId = opts?.buyerCustomerId ?? sessionCustomerId
  if (!customerId) {
    const byRef = await crm.findCustomerByExternalRef(tenantId, q.customerRef)
    customerId = byRef?.id
  }
  if (!customerId) throw new ApiError(400, 'Could not resolve customer for quote')

  const lineItems = await quoteToOrderLines(tenantId, q)

  const order = await orders.createOrder(
    tenantId,
    {
      customerId,
      channel: 'B2B_PORTAL',
      paymentMethod: 'NET_TERMS',
      notes: q.notes ?? undefined,
      lineItems,
    },
    opts?.buyerCustomerId ? { buyerCustomerId: opts.buyerCustomerId } : undefined,
  )

  return storefrontDb.b2BQuote.update({
    where: { id },
    data: { status: QuoteStatus.SUBMITTED, convertedOrderId: order.id },
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

  await storefrontDb.quoteLine.deleteMany({ where: { quoteId } })
  await storefrontDb.b2BQuote.update({
    where: { id: quoteId },
    data: {
      status: QuoteStatus.OPEN,
      lines: {
        create: offer.lines.map((l) => ({
          lineNo: l.lineNo,
          description: `Line ${l.lineNo}`,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
      },
    },
  })
  await storefrontDb.quoteCounterOffer.update({ where: { id: counterOfferId }, data: { status: 'ACCEPTED' } })
  return getQuote(tenantId, quoteId)
}
