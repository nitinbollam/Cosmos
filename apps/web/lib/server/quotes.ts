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

export async function submitQuote(
  tenantId: string,
  id: string,
  sessionCustomerId?: string,
  opts?: { buyerCustomerId?: string },
) {
  const q = await getQuote(tenantId, id, opts)
  if (q.convertedOrderId) return getQuote(tenantId, id, opts)
  if (q.status !== QuoteStatus.OPEN) throw new ApiError(400, 'Only OPEN quotes can be submitted')

  let customerId = opts?.buyerCustomerId ?? sessionCustomerId
  if (!customerId) {
    const byRef = await crm.findCustomerByExternalRef(tenantId, q.customerRef)
    customerId = byRef?.id
  }
  if (!customerId) throw new ApiError(400, 'Could not resolve customer for quote')

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
