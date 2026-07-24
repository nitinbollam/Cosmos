import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-order'
import { orderDb } from './db'
import * as crm from './crm'
import { deriveInvoiceStatus, formatCreditMemoNumber, formatInvoiceNumber, invoiceBalance, toStoredInvoiceStatus } from './invoice-status'
import { postInvoiceJournal, postCreditMemoJournal } from './invoice-gl'
import * as notifyTriggers from './notification-triggers'
import { ApiError } from './session'

function orderSubtotal(lineItems: Array<{ quantity: number; unitPrice: Prisma.Decimal }>): number {
  return lineItems.reduce((s, li) => s + li.quantity * Number(li.unitPrice), 0)
}

function invoiceDueDate(paymentTermsDays: number | null | undefined, issuedAt: Date): Date {
  const days = paymentTermsDays && paymentTermsDays > 0 ? paymentTermsDays : 30
  const due = new Date(issuedAt)
  due.setDate(due.getDate() + days)
  return due
}

export async function issueInvoiceForOrder(
  tenantId: string,
  orderId: string,
  amounts?: { subtotal: number; taxAmount: number; totalAmount: number },
) {
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true, invoice: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.status === 'CANCELLED' || order.status === 'FAILED') {
    throw new ApiError(400, 'Cannot invoice a cancelled order')
  }
  if (order.invoice) return order.invoice

  const subtotal = amounts?.subtotal ?? orderSubtotal(order.lineItems)
  const taxAmount = amounts?.taxAmount ?? Number(order.taxAmount ?? 0)
  const totalAmount = amounts?.totalAmount ?? Number(order.totalAmount)
  const issuedAt = new Date()

  let dueAt: Date | undefined
  try {
    const customer = await crm.getCustomer(tenantId, order.customerId)
    dueAt = invoiceDueDate(customer.paymentTermsDays, issuedAt)
  } catch {
    dueAt = invoiceDueDate(30, issuedAt)
  }

  const paidApplied = Math.min(Number(order.amountPaid ?? 0), totalAmount)
  const invoice = await orderDb.invoice.create({
    data: {
      tenantId,
      orderId: order.id,
      invoiceNumber: formatInvoiceNumber(order.id),
      customerId: order.customerId,
      subtotal: new Prisma.Decimal(subtotal),
      taxAmount: new Prisma.Decimal(taxAmount),
      totalAmount: new Prisma.Decimal(totalAmount),
      amountPaid: new Prisma.Decimal(paidApplied),
      issuedAt,
      dueAt,
      status: toStoredInvoiceStatus(
        deriveInvoiceStatus({
          totalAmount,
          amountPaid: paidApplied,
          amountCredited: 0,
          paymentMethod: order.paymentMethod,
          issuedAt,
        }),
      ) as never,
    },
  })

  const journalEntryId = await postInvoiceJournal(tenantId, invoice.id, totalAmount).catch((err) => {
    console.error(`[gl] invoice journal failed for invoice ${invoice.id}:`, err)
    return null
  })
  const finalInvoice = journalEntryId
    ? await orderDb.invoice.update({
        where: { id: invoice.id },
        data: { journalEntryId },
      })
    : invoice

  void notifyTriggers
    .notifyInvoiceIssued(
      tenantId,
      finalInvoice.id,
      order.id,
      order.customerId,
      finalInvoice.invoiceNumber,
      totalAmount,
      dueAt,
    )
    .catch(() => undefined)

  if (order.channel === 'EDI') {
    void import('./edi')
      .then((m) => m.generate810ForInvoice(tenantId, finalInvoice.id))
      .catch(() => undefined)
  }

  return finalInvoice
}

/**
 * Bill exactly what shipped. First shipment creates the invoice from shipped
 * quantities (not ordered quantities — SHORT picks and backorders bill later);
 * follow-up shipments augment the same invoice and post a delta AR journal.
 */
export async function invoiceShipmentForOrder(
  tenantId: string,
  orderId: string,
  shippedLines: Array<{ skuId: string; quantity: number }>,
) {
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true, invoice: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')

  const priceBySku = new Map<string, number>()
  for (const li of order.lineItems) {
    if (!priceBySku.has(li.skuId)) priceBySku.set(li.skuId, Number(li.unitPrice))
  }

  const subtotal = +shippedLines
    .reduce((s, l) => s + l.quantity * (priceBySku.get(l.skuId) ?? 0), 0)
    .toFixed(2)
  if (subtotal <= 0) return order.invoice ?? null

  const orderSub = orderSubtotal(order.lineItems)
  const taxRate = orderSub > 0 ? Number(order.taxAmount ?? 0) / orderSub : 0
  const taxAmount = +(subtotal * taxRate).toFixed(2)
  const totalAmount = +(subtotal + taxAmount).toFixed(2)

  if (!order.invoice) {
    return issueInvoiceForOrder(tenantId, orderId, { subtotal, taxAmount, totalAmount })
  }

  // Follow-up shipment: extend the existing invoice and post the delta to AR.
  const newSubtotal = +(Number(order.invoice.subtotal) + subtotal).toFixed(2)
  const newTax = +(Number(order.invoice.taxAmount) + taxAmount).toFixed(2)
  const newTotal = +(Number(order.invoice.totalAmount) + totalAmount).toFixed(2)
  const paidApplied = Math.min(Number(order.amountPaid ?? 0), newTotal)

  const updated = await orderDb.invoice.update({
    where: { id: order.invoice.id },
    data: {
      subtotal: new Prisma.Decimal(newSubtotal),
      taxAmount: new Prisma.Decimal(newTax),
      totalAmount: new Prisma.Decimal(newTotal),
      amountPaid: new Prisma.Decimal(paidApplied),
      status: toStoredInvoiceStatus(
        deriveInvoiceStatus({
          orderStatus: order.status,
          totalAmount: newTotal,
          amountPaid: paidApplied,
          amountCredited: Number(order.invoice.amountCredited),
          paymentMethod: order.paymentMethod,
          issuedAt: order.invoice.issuedAt,
        }),
      ) as never,
    },
  })

  await postInvoiceJournal(tenantId, updated.id, totalAmount).catch((err) => {
    console.error(`[gl] shipment invoice journal failed for invoice ${updated.id}:`, err)
    return null
  })

  return updated
}

export async function syncInvoiceFromOrder(tenantId: string, orderId: string) {
  const invoice = await orderDb.invoice.findFirst({ where: { tenantId, orderId } })
  if (!invoice) return null

  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) return invoice

  const total = Number(invoice.totalAmount)
  const paid = Number(order.amountPaid ?? 0)
  const credited = Number(invoice.amountCredited)
  const status = deriveInvoiceStatus({
    orderStatus: order.status,
    totalAmount: total,
    amountPaid: paid,
    amountCredited: credited,
    paymentMethod: order.paymentMethod,
    issuedAt: invoice.issuedAt,
  })

  return orderDb.invoice.update({
    where: { id: invoice.id },
    data: {
      amountPaid: new Prisma.Decimal(paid),
      status: toStoredInvoiceStatus(status) as never,
    },
  })
}

export type ArAgingBuckets = {
  current: number
  d30: number
  d60: number
  d90: number
  d90p: number
}

export type ArSummary = {
  invoiced: number
  collected: number
  outstanding: number
  count: number
  aging: ArAgingBuckets
}

/** Pure aging bucket helper (days since issue → outstanding balance bucket). */
export function bucketArAging(days: number, balance: number, buckets: ArAgingBuckets): void {
  if (balance <= 0.01) return
  if (days <= 30) buckets.current += balance
  else if (days <= 60) buckets.d30 += balance
  else if (days <= 90) buckets.d60 += balance
  else if (days <= 120) buckets.d90 += balance
  else buckets.d90p += balance
}

/**
 * Lean AR totals + aging for Finance KPIs — aggregates on the server so the
 * browser never loads hundreds of invoice rows just for summary cards.
 */
export async function getArSummary(tenantId: string): Promise<ArSummary> {
  const rows = await orderDb.invoice.findMany({
    where: { tenantId },
    select: {
      totalAmount: true,
      amountPaid: true,
      amountCredited: true,
      issuedAt: true,
      order: { select: { status: true } },
    },
  })

  const aging: ArAgingBuckets = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 }
  let invoiced = 0
  let collected = 0
  let outstanding = 0
  let count = 0
  const now = Date.now()

  for (const inv of rows) {
    if (inv.order.status === 'CANCELLED') continue
    count += 1
    const total = Number(inv.totalAmount)
    const paid = Number(inv.amountPaid)
    const credited = Number(inv.amountCredited)
    const balance = invoiceBalance(total, paid, credited)
    invoiced += total + credited
    collected += paid
    outstanding += balance
    if (inv.order.status === 'FAILED') continue
    const days = (now - inv.issuedAt.getTime()) / 86_400_000
    bucketArAging(days, balance, aging)
  }

  return {
    invoiced: +invoiced.toFixed(2),
    collected: +collected.toFixed(2),
    outstanding: +outstanding.toFixed(2),
    count,
    aging: {
      current: +aging.current.toFixed(2),
      d30: +aging.d30.toFixed(2),
      d60: +aging.d60.toFixed(2),
      d90: +aging.d90.toFixed(2),
      d90p: +aging.d90p.toFixed(2),
    },
  }
}

export async function listInvoices(
  tenantId: string,
  page = 1,
  pageSize = 50,
  filters?: { status?: string; customerId?: string; excludeCancelled?: boolean },
  opts?: { buyerCustomerId?: string },
) {
  const safePage = Math.max(1, page)
  const safePageSize = Math.min(100, Math.max(1, pageSize))
  const where: Prisma.InvoiceWhereInput = { tenantId }
  if (opts?.buyerCustomerId) {
    where.customerId = opts.buyerCustomerId
  } else if (filters?.customerId?.trim()) {
    where.customerId = filters.customerId.trim()
  }

  const status = filters?.status?.trim()
  if (status && status !== 'ALL') {
    if (status === 'FAILED') {
      where.order = { status: 'FAILED' }
    } else if (status === 'OVERDUE') {
      const raw = await orderDb.invoice.findMany({
        where: { ...where, status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, order: { status: { notIn: ['CANCELLED', 'FAILED'] } } },
        include: { order: { select: { status: true, paymentMethod: true, channel: true } }, creditMemos: true },
        orderBy: { issuedAt: 'desc' },
        take: 2000,
      })
      const overdue = raw.filter(
        (inv) =>
          deriveInvoiceStatus({
            orderStatus: inv.order.status,
            totalAmount: Number(inv.totalAmount),
            amountPaid: Number(inv.amountPaid),
            amountCredited: Number(inv.amountCredited),
            paymentMethod: inv.order.paymentMethod,
            issuedAt: inv.issuedAt,
          }) === 'OVERDUE',
      )
      const slice = overdue.slice((safePage - 1) * safePageSize, safePage * safePageSize)
      return {
        items: slice.map((inv) => ({
          ...inv,
          balance: invoiceBalance(Number(inv.totalAmount), Number(inv.amountPaid), Number(inv.amountCredited)),
          displayStatus: 'OVERDUE' as const,
        })),
        total: overdue.length,
        page: safePage,
        pageSize: safePageSize,
        hasMore: safePage * safePageSize < overdue.length,
      }
    } else {
      where.status = status as never
      where.order = { status: { notIn: ['CANCELLED', 'FAILED'] } }
    }
  } else if (filters?.excludeCancelled) {
    where.order = { status: { not: 'CANCELLED' } }
  }

  const [items, total] = await Promise.all([
    orderDb.invoice.findMany({
      where,
      include: { order: { select: { status: true, paymentMethod: true, channel: true } }, creditMemos: true },
      orderBy: { issuedAt: 'desc' },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    orderDb.invoice.count({ where }),
  ])

  return {
    items: items.map((inv) => ({
      ...inv,
      balance: invoiceBalance(Number(inv.totalAmount), Number(inv.amountPaid), Number(inv.amountCredited)),
      displayStatus: deriveInvoiceStatus({
        orderStatus: inv.order.status,
        totalAmount: Number(inv.totalAmount),
        amountPaid: Number(inv.amountPaid),
        amountCredited: Number(inv.amountCredited),
        paymentMethod: inv.order.paymentMethod,
        issuedAt: inv.issuedAt,
      }),
    })),
    total,
    page: safePage,
    pageSize: safePageSize,
    hasMore: safePage * safePageSize < total,
  }
}

export async function getInvoice(tenantId: string, id: string, opts?: { buyerCustomerId?: string }) {
  const row = await orderDb.invoice.findFirst({
    where: { id, tenantId },
    include: {
      order: { include: { lineItems: true } },
      creditMemos: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!row) throw new ApiError(404, 'Invoice not found')
  if (opts?.buyerCustomerId && row.customerId !== opts.buyerCustomerId) {
    throw new ApiError(404, 'Invoice not found')
  }
  return {
    ...row,
    balance: invoiceBalance(Number(row.totalAmount), Number(row.amountPaid), Number(row.amountCredited)),
    displayStatus: deriveInvoiceStatus({
      orderStatus: row.order.status,
      totalAmount: Number(row.totalAmount),
      amountPaid: Number(row.amountPaid),
      amountCredited: Number(row.amountCredited),
      paymentMethod: row.order.paymentMethod,
      issuedAt: row.issuedAt,
    }),
  }
}

export async function getInvoiceByOrderId(tenantId: string, orderId: string, opts?: { buyerCustomerId?: string }) {
  const row = await orderDb.invoice.findFirst({ where: { tenantId, orderId } })
  if (!row) throw new ApiError(404, 'Invoice not found')
  return getInvoice(tenantId, row.id, opts)
}

export async function recordInvoicePayment(
  tenantId: string,
  invoiceId: string,
  body: { amount: number; method: string; reference?: string },
  opts?: { buyerCustomerId?: string },
) {
  const invoice = await getInvoice(tenantId, invoiceId, opts)
  if (invoice.balance <= 0.01) throw new ApiError(400, 'Invoice is already paid')

  const { recordOrderPayment } = await import('./orders')
  await recordOrderPayment(tenantId, invoice.orderId, body)

  return getInvoice(tenantId, invoiceId, opts)
}

type InvoiceDocOpts = { buyerCustomerId?: string }

async function invoiceToDocInput(
  tenantId: string,
  invoiceId: string,
  opts?: InvoiceDocOpts,
) {
  const inv = await getInvoice(tenantId, invoiceId, opts)
  return {
    invoiceNumber: inv.invoiceNumber,
    issuedAt: inv.issuedAt,
    dueAt: inv.dueAt,
    customerId: inv.customerId,
    subtotal: Number(inv.subtotal),
    taxAmount: Number(inv.taxAmount),
    totalAmount: Number(inv.totalAmount),
    amountPaid: Number(inv.amountPaid),
    balance: inv.balance,
    displayStatus: inv.displayStatus,
    lineItems: inv.order.lineItems.map((li) => ({
      skuId: li.skuId,
      quantity: li.quantity,
      unitPrice: Number(li.unitPrice),
    })),
    creditMemos: inv.creditMemos?.map((cm) => ({
      memoNumber: cm.memoNumber,
      totalAmount: Number(cm.totalAmount),
      reason: cm.reason,
    })),
  }
}

export async function getInvoiceHtmlDocument(tenantId: string, invoiceId: string, opts?: InvoiceDocOpts) {
  const input = await invoiceToDocInput(tenantId, invoiceId, opts)
  const { buildInvoiceHtml } = await import('./invoice-document')
  return buildInvoiceHtml(tenantId, input)
}

export async function getInvoicePdfDocument(tenantId: string, invoiceId: string, opts?: InvoiceDocOpts) {
  const input = await invoiceToDocInput(tenantId, invoiceId, opts)
  const { buildInvoicePdf } = await import('./invoice-document')
  const pdf = await buildInvoicePdf(tenantId, input)
  return { pdf, invoiceNumber: input.invoiceNumber }
}

export async function payInvoiceWithStripe(
  tenantId: string,
  invoiceId: string,
  body: { paymentMethodId: string; amount?: number; correlationId: string },
  opts?: { buyerCustomerId?: string },
) {
  const invoice = await getInvoice(tenantId, invoiceId, opts)
  if (invoice.balance <= 0.01) throw new ApiError(400, 'Invoice is already paid')
  const amount = body.amount != null ? Math.min(body.amount, invoice.balance) : invoice.balance
  if (amount <= 0) throw new ApiError(400, 'Invalid payment amount')

  const payments = await import('./payments')
  const auth = await payments.authorize(tenantId, {
    orderId: invoice.orderId,
    amount,
    currency: 'usd',
    paymentMethod: 'CARD',
    customerId: invoice.customerId,
    paymentMethodId: body.paymentMethodId,
    correlationId: body.correlationId,
  })
  await payments.capture(tenantId, auth.paymentIntentId, body.correlationId)

  return getInvoice(tenantId, invoiceId, opts)
}

export type ApplyCreditMemoInput = {
  orderId: string
  reason?: string
  lines: Array<{ lineItemId: string; quantity: number }>
  restock?: boolean
}

export async function applyCreditMemo(
  tenantId: string,
  input: ApplyCreditMemoInput,
  performedBy: string,
) {
  const order = await orderDb.order.findFirst({
    where: { id: input.orderId, tenantId },
    include: { lineItems: true, invoice: { include: { creditMemos: true } } },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (!['SHIPPED', 'DELIVERED', 'RETURNED'].includes(order.status)) {
    throw new ApiError(400, `Returns not allowed from status ${order.status}`)
  }

  let invoiceId = order.invoice?.id
  if (!invoiceId) {
    const issued = await issueInvoiceForOrder(tenantId, order.id)
    invoiceId = issued.id
  }
  const invoice = await orderDb.invoice.findFirst({
    where: { id: invoiceId },
    include: { creditMemos: true },
  })
  if (!invoice) throw new ApiError(500, 'Could not resolve invoice for return')

  const memoLines: Array<{
    orderLineId: string
    skuId: string
    warehouseId: string
    quantity: number
    unitPrice: number
  }> = []

  for (const req of input.lines) {
    const line = order.lineItems.find((l) => l.id === req.lineItemId)
    if (!line) throw new ApiError(400, `Unknown line item ${req.lineItemId}`)
    const remaining = line.quantity - line.returnedQty
    if (req.quantity <= 0 || req.quantity > remaining) {
      throw new ApiError(400, `Invalid return quantity for line ${req.lineItemId}`)
    }
    memoLines.push({
      orderLineId: line.id,
      skuId: line.skuId,
      warehouseId: line.warehouseId,
      quantity: req.quantity,
      unitPrice: Number(line.unitPrice),
    })
  }

  const creditSubtotal = memoLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const orderSub = orderSubtotal(order.lineItems)
  const taxRate = orderSub > 0 ? Number(order.taxAmount ?? 0) / orderSub : 0
  const creditTax = +(creditSubtotal * taxRate).toFixed(2)
  const creditTotal = +(creditSubtotal + creditTax).toFixed(2)

  const seq = (invoice.creditMemos?.length ?? 0) + 1
  const memoNumber = formatCreditMemoNumber(order.id, seq)

  const creditMemo = await orderDb.creditMemo.create({
    data: {
      tenantId,
      orderId: order.id,
      invoiceId: invoice.id,
      memoNumber,
      customerId: order.customerId,
      totalAmount: new Prisma.Decimal(creditTotal),
      reason: input.reason,
      lines: memoLines as never,
    },
  })

  for (const ml of memoLines) {
    await orderDb.orderLineItem.update({
      where: { id: ml.orderLineId },
      data: { returnedQty: { increment: ml.quantity } },
    })
    if (input.restock !== false) {
      const { adjustStock } = await import('./inventory')
      await adjustStock(
        tenantId,
        {
          skuId: ml.skuId,
          warehouseId: ml.warehouseId,
          quantityDelta: ml.quantity,
          reason: input.reason ?? 'Customer return',
          referenceId: creditMemo.id,
          referenceType: 'CREDIT_MEMO',
          correlationId: randomUUID(),
        },
        performedBy,
      )
    }
  }

  const newCredited = Number(invoice.amountCredited) + creditTotal
  const newOrderTotal = Math.max(0, +(Number(order.totalAmount) - creditTotal).toFixed(2))
  const newOrderTax = Math.max(0, +(Number(order.taxAmount ?? 0) - creditTax).toFixed(2))

  await orderDb.order.update({
    where: { id: order.id },
    data: {
      totalAmount: new Prisma.Decimal(newOrderTotal),
      taxAmount: new Prisma.Decimal(newOrderTax),
    },
  })

  const allReturned = order.lineItems.every((li) => {
    const ret = memoLines.find((m) => m.orderLineId === li.id)?.quantity ?? 0
    return li.returnedQty + ret >= li.quantity
  })

  if (allReturned) {
    await orderDb.order.update({ where: { id: order.id }, data: { status: 'RETURNED' } })
  }

  const updatedInvoice = await orderDb.invoice.update({
    where: { id: invoice.id },
    data: {
      amountCredited: new Prisma.Decimal(newCredited),
      totalAmount: new Prisma.Decimal(Math.max(0, Number(invoice.totalAmount) - creditTotal)),
      taxAmount: new Prisma.Decimal(Math.max(0, Number(invoice.taxAmount) - creditTax)),
      status: toStoredInvoiceStatus(
        deriveInvoiceStatus({
          orderStatus: allReturned ? 'RETURNED' : order.status,
          totalAmount: Number(invoice.totalAmount) - creditTotal,
          amountPaid: Number(invoice.amountPaid),
          amountCredited: newCredited,
          paymentMethod: order.paymentMethod,
          issuedAt: invoice.issuedAt,
        }),
      ) as never,
    },
  })

  if (order.paymentMethod === 'NET_TERMS') {
    const { releaseCreditUsed } = await import('./credit-limit')
    await releaseCreditUsed(tenantId, order.customerId, creditTotal).catch(() => undefined)
  }

  const journalEntryId = await postCreditMemoJournal(tenantId, creditMemo.id, creditTotal).catch((err) => {
    console.error(`[gl] credit memo journal failed for ${creditMemo.id}:`, err)
    return null
  })
  if (journalEntryId) {
    await orderDb.creditMemo.update({ where: { id: creditMemo.id }, data: { journalEntryId } })
  }

  // Restocked goods reverse their ship-time COGS.
  if (input.restock !== false) {
    const { computeOrderCogs, postCogsReversalJournal } = await import('./operations-gl')
    const returnedCogs = await computeOrderCogs(
      tenantId,
      memoLines.map((ml) => ({ skuId: ml.skuId, quantity: ml.quantity })),
    )
    await postCogsReversalJournal(tenantId, creditMemo.id, returnedCogs).catch((err) =>
      console.error(`[gl] COGS reversal failed for credit memo ${creditMemo.id}:`, err),
    )
  }

  // Money back: refund captured card/ACH payments up to the credited amount.
  const paidSoFar = Number(order.amountPaid ?? 0)
  const refundDue = Math.min(creditTotal, paidSoFar)
  if (refundDue > 0.009) {
    const { paymentDb } = await import('./db')
    const intent = await paymentDb.paymentIntent.findFirst({
      where: { tenantId, orderId: order.id, status: { in: ['CAPTURED', 'REFUNDED'] } },
      orderBy: { createdAt: 'desc' },
    })
    const refundable = intent ? Number(intent.amount) - Number(intent.refundedAmount ?? 0) : 0
    if (intent && intent.status === 'CAPTURED' && refundable > 0.009) {
      const payments = await import('./payments')
      const refundAmount = Math.min(refundDue, refundable)
      try {
        await payments.refund(tenantId, intent.id, refundAmount, randomUUID())
        await orderDb.order.update({
          where: { id: order.id },
          data: { amountPaid: new Prisma.Decimal(Math.max(0, paidSoFar - refundAmount)) },
        })
        await syncInvoiceFromOrder(tenantId, order.id).catch(() => undefined)
      } catch (err) {
        console.error(`[payments] refund failed for credit memo ${creditMemo.id}:`, err)
      }
    }
  }

  return {
    creditMemo,
    invoice: updatedInvoice,
    order: await orderDb.order.findFirst({
      where: { id: order.id },
      include: { lineItems: true, invoice: true },
    }),
  }
}
