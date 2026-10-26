import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-order'
import { orderDb } from './db'
import * as crm from './crm'
import { deriveInvoiceStatus, formatCreditMemoNumber, formatInvoiceNumber, invoiceBalance, toStoredInvoiceStatus } from './invoice-status'
import { enqueuePostingJob } from './posting-outbox'
import * as notifyTriggers from './notification-triggers'
import { ApiError } from './session'
import { resolveFxRateAtCreation } from './exchange-rates'
import { toBaseAmount, normalizeCurrency } from './fx-util'
import { splitBaseAmounts } from './invoice-tax-split'
import { attemptOrQueue, syncInvoiceOrQueue } from './deferred-work'
import { swallowed } from './fire-and-forget'
import { formatMoney } from './money'
import { assertWithinBalance, invoiceRemaining, parsePaymentAmount } from './payment-amount'
import {
  allocateShipmentTax,
  inferLegacyInvoiced,
  lineSubtotal,
  priceShipment,
  type BillableLine,
} from './invoice-pricing'

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
  amounts?: { subtotal: number; taxAmount: number; totalAmount: number; currency?: string },
  /** Runs inside the invoice's transaction, so related bookkeeping commits or rolls back with it. */
  inTransaction?: (tx: Prisma.TransactionClient, invoice: { id: string }) => Promise<void>,
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
  const fx = await resolveFxRateAtCreation(tenantId, normalizeCurrency(amounts?.currency))
  const { baseTotal, baseTax } = splitBaseAmounts(totalAmount, taxAmount, fx.fxRateToBase)
  // The invoice and its ledger posting job commit together; a worker posts to the ledger (posting-outbox).
  const finalInvoice = await orderDb.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        orderId: order.id,
        invoiceNumber: formatInvoiceNumber(order.id),
        customerId: order.customerId,
        subtotal: new Prisma.Decimal(subtotal),
        taxAmount: new Prisma.Decimal(taxAmount),
        totalAmount: new Prisma.Decimal(totalAmount),
        amountPaid: new Prisma.Decimal(paidApplied),
        currency: fx.currency,
        fxRateToBase: new Prisma.Decimal(fx.fxRateToBase),
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
    await enqueuePostingJob(tx, {
      tenantId,
      kind: 'INVOICE_JOURNAL',
      sourceType: 'Invoice',
      sourceId: invoice.id,
      amount: baseTotal.toFixed(2),
      taxAmount: baseTax.toFixed(2),
    })
    if (inTransaction) await inTransaction(tx, invoice)
    return invoice
  })

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
    .catch(swallowed('invoices.issueInvoiceForOrder'))
  const { emitDomainEvent } = await import('./domain-events')
  void emitDomainEvent(
    tenantId,
    'finance.invoice_generated',
    {
      invoiceId: finalInvoice.id,
      invoiceNumber: finalInvoice.invoiceNumber,
      orderId: order.id,
      customerId: order.customerId,
      totalAmount,
      dueAt: dueAt?.toISOString() ?? null,
    },
    { key: finalInvoice.id },
  )

  if (order.channel === 'EDI') {
    void import('./edi')
      .then((m) => m.generate810ForInvoice(tenantId, finalInvoice.id))
      .catch(swallowed('invoices.issueInvoiceForOrder2'))
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
  shippedLines: Array<{ skuId: string; quantity: number; lineId?: string }>,
  /**
   * The fulfillment task that shipped these lines. When given, billing is recorded against it in
   * the same transaction as the invoice change, so a retried dispatch returns the existing result
   * instead of billing the shipment again.
   */
  fulfillmentTaskId?: string,
) {
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: { orderBy: { id: 'asc' } }, invoice: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (fulfillmentTaskId) {
    const done = await orderDb.shipmentInvoice.findFirst({ where: { tenantId, fulfillmentTaskId } })
    if (done) return order.invoice
  }

  let lines: BillableLine[] = order.lineItems.map((li) => ({
    id: li.id,
    skuId: li.skuId,
    quantity: li.quantity,
    quantityInvoiced: li.quantityInvoiced,
    unitPrice: li.unitPrice,
  }))
  // Orders invoiced before per-line tracking existed: infer what was already billed.
  if (order.invoice && lines.every((l) => l.quantityInvoiced === 0)) {
    lines = inferLegacyInvoiced(lines, order.invoice.subtotal)
  }

  const { allocations, subtotal } = priceShipment(lines, shippedLines)
  if (subtotal.lte(0)) return order.invoice ?? null

  const orderSub = lineSubtotal(lines)
  const invoicedSoFar = order.invoice?.subtotal ?? new Prisma.Decimal(0)
  if (invoicedSoFar.add(subtotal).gt(orderSub)) {
    console.error(`[invoices] shipment would exceed order subtotal for order ${orderId}`)
    throw new ApiError(409, 'Invoice would exceed the order total')
  }

  const open = new Map(lines.map((l) => [l.id, l.quantity - l.quantityInvoiced]))
  for (const a of allocations) open.set(a.lineId, (open.get(a.lineId) ?? 0) - a.quantity)
  const completesOrder = [...open.values()].every((q) => q <= 0)

  const taxAmount = allocateShipmentTax({
    orderSubtotal: orderSub,
    orderTax: order.taxAmount ?? new Prisma.Decimal(0),
    invoicedTaxSoFar: order.invoice?.taxAmount ?? new Prisma.Decimal(0),
    shipmentSubtotal: subtotal,
    completesOrder,
  })
  const totalAmount = subtotal.add(taxAmount)

  const markInvoiced = (tx: Prisma.TransactionClient) =>
    Promise.all(
      allocations.map((a) =>
        tx.orderLineItem.update({ where: { id: a.lineId }, data: { quantityInvoiced: { increment: a.quantity } } }),
      ),
    )

  const recordTask = (tx: Prisma.TransactionClient, invoiceId: string) =>
    fulfillmentTaskId
      ? tx.shipmentInvoice.create({ data: { tenantId, fulfillmentTaskId, orderId, invoiceId } })
      : Promise.resolve(null)

  if (!order.invoice) {
    // Amounts are exact 2dp decimals; numbers appear only at the issueInvoiceForOrder boundary.
    // The line counters and the task record commit with the invoice itself, so there is no window
    // in which an invoice exists but its lines still look unbilled.
    return issueInvoiceForOrder(
      tenantId,
      orderId,
      {
        subtotal: subtotal.toNumber(),
        taxAmount: taxAmount.toNumber(),
        totalAmount: totalAmount.toNumber(),
      },
      async (tx, invoice) => {
        await markInvoiced(tx)
        await recordTask(tx, invoice.id)
      },
    )
  }

  // Follow-up shipment: extend the existing invoice and post the delta to AR.
  const existingInvoice = order.invoice
  const invoiceId = existingInvoice.id
  const newSubtotal = existingInvoice.subtotal.add(subtotal)
  const newTax = existingInvoice.taxAmount.add(taxAmount)
  const newTotal = existingInvoice.totalAmount.add(totalAmount)
  const paidApplied = Prisma.Decimal.min(order.amountPaid ?? new Prisma.Decimal(0), newTotal)
  const extension = splitBaseAmounts(totalAmount.toNumber(), taxAmount.toNumber(), Number(existingInvoice.fxRateToBase))

  const updated = await orderDb.$transaction(async (tx) => {
    const row = await tx.invoice.update({
      where: { id: invoiceId, tenantId },
      data: {
        subtotal: newSubtotal,
        taxAmount: newTax,
        totalAmount: newTotal,
        amountPaid: paidApplied,
        status: toStoredInvoiceStatus(
          deriveInvoiceStatus({
            orderStatus: order.status,
            totalAmount: newTotal.toNumber(),
            amountPaid: paidApplied.toNumber(),
            amountCredited: Number(existingInvoice.amountCredited),
            paymentMethod: order.paymentMethod,
            issuedAt: existingInvoice.issuedAt,
          }),
        ) as never,
      },
    })
    await markInvoiced(tx)
    await recordTask(tx, invoiceId)
    // Each extension gets its own posting, keyed by the fulfillment task when there is one so a
    // retried dispatch maps to the same posting.
    await enqueuePostingJob(tx, {
      tenantId,
      kind: 'INVOICE_EXTENSION_JOURNAL',
      sourceType: 'Invoice',
      sourceId: invoiceId,
      variant: `ext:${fulfillmentTaskId ?? randomUUID()}`,
      amount: extension.baseTotal.toFixed(2),
      taxAmount: extension.baseTax.toFixed(2),
    })
    return row
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
  // Any balance still owed is aged, a single cent included, so the buckets add up to `outstanding`.
  if (balance <= 0) return
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
      fxRateToBase: true,
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
    const fx = Number(inv.fxRateToBase ?? 1)
    const balance = toBaseAmount(invoiceBalance(total, paid, credited), fx)
    invoiced += toBaseAmount(total + credited, fx)
    collected += toBaseAmount(paid, fx)
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
        include: { order: { select: { orderNumber: true, status: true, paymentMethod: true, channel: true } }, creditMemos: true },
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
      include: { order: { select: { orderNumber: true, status: true, paymentMethod: true, channel: true } }, creditMemos: true },
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
  body: { amount: number | string; method: string; reference?: string },
  opts?: { buyerCustomerId?: string },
) {
  const amount = parsePaymentAmount(body.amount)
  const invoice = await getInvoice(tenantId, invoiceId, opts)
  const remaining = invoiceRemaining(invoice)
  if (remaining.lte(0)) throw new ApiError(400, 'Invoice is already paid')
  // The invoice's own balance; recordOrderPayment checks the order's again as it writes.
  assertWithinBalance(amount, remaining)

  const { recordOrderPayment } = await import('./orders')
  await recordOrderPayment(tenantId, invoice.orderId, { ...body, amount: formatMoney(amount) })

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
  body: { paymentMethodId: string; amount?: number | string | null; correlationId: string },
  opts?: { buyerCustomerId?: string },
) {
  const invoice = await getInvoice(tenantId, invoiceId, opts)
  const remaining = invoiceRemaining(invoice)
  if (remaining.lte(0)) throw new ApiError(400, 'Invoice is already paid')
  // No amount (absent or null) means the whole balance. Any amount that is given is checked here,
  // before anything reaches Stripe, and an invalid one is rejected rather than replaced.
  let amount = remaining
  if (body.amount != null) {
    amount = parsePaymentAmount(body.amount)
    assertWithinBalance(amount, remaining)
  }

  const orderPaymentAdmin = await import('./order-payment-admin')
  const result = await orderPaymentAdmin.collectOrderCardPayment(tenantId, invoice.orderId, {
    paymentMethodId: body.paymentMethodId,
    amount: amount.toNumber(),
    correlationId: body.correlationId,
    customerId: invoice.customerId,
  })

  if (result.requiresAction && result.clientSecret) {
    return {
      requiresAction: true as const,
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      invoice: await getInvoice(tenantId, invoiceId, opts),
    }
  }

  return getInvoice(tenantId, invoiceId, opts)
}

export type ApplyCreditMemoInput = {
  orderId: string
  reason?: string
  lines: Array<{ lineItemId: string; quantity: number }>
  restock?: boolean
  /** Put restocked units here instead of the warehouse they shipped from (a driver's van, PLR-166). */
  restockWarehouseId?: string
  /** Refund captured Stripe payment up to credit memo total (CARD orders). */
  refundToCard?: boolean
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

  const credit = splitBaseAmounts(creditTotal, creditTax, Number(invoice.fxRateToBase))
  const creditMemo = await orderDb.$transaction(async (tx) => {
    const memo = await tx.creditMemo.create({
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
    await enqueuePostingJob(tx, {
      tenantId,
      kind: 'CREDIT_MEMO_JOURNAL',
      sourceType: 'CreditMemo',
      sourceId: memo.id,
      amount: credit.baseTotal.toFixed(2),
      taxAmount: credit.baseTax.toFixed(2),
    })
    return memo
  })

  for (const ml of memoLines) {
    await orderDb.orderLineItem.update({
      where: { id: ml.orderLineId },
      data: { returnedQty: { increment: ml.quantity } },
    })
    if (input.restock !== false) {
      const { adjustStock, ensureStockLevel } = await import('./inventory')
      const restockAt = input.restockWarehouseId ?? ml.warehouseId
      if (input.restockWarehouseId) {
        await ensureStockLevel(tenantId, { skuId: ml.skuId, warehouseId: restockAt })
      }
      await adjustStock(
        tenantId,
        {
          skuId: ml.skuId,
          warehouseId: restockAt,
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
    await attemptOrQueue(
      {
        tenantId,
        kind: 'CREDIT_RELEASE',
        sourceType: 'CreditMemo',
        sourceId: creditMemo.id,
        payload: { customerId: order.customerId, amount: String(creditTotal) },
      },
      () => releaseCreditUsed(tenantId, order.customerId, creditTotal),
    )
  }

  // Restocked goods reverse their ship-time COGS.
  if (input.restock !== false) {
    const { computeOrderCogs } = await import('./operations-gl')
    const returnedCogs = await computeOrderCogs(
      tenantId,
      memoLines.map((ml) => ({ skuId: ml.skuId, quantity: ml.quantity })),
    )
    await enqueuePostingJob(orderDb, {
      tenantId,
      kind: 'COGS_REVERSAL_JOURNAL',
      sourceType: 'CreditMemo',
      sourceId: creditMemo.id,
      amount: returnedCogs.toFixed(2),
    })
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
        await syncInvoiceOrQueue(tenantId, order.id)
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
