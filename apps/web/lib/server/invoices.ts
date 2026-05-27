import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-order'
import { orderDb } from './db'
import * as crm from './crm'
import { deriveInvoiceStatus, formatCreditMemoNumber, formatInvoiceNumber, invoiceBalance, toStoredInvoiceStatus } from './invoice-status'
import { postInvoiceJournal, postCreditMemoJournal } from './invoice-gl'
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

export async function issueInvoiceForOrder(tenantId: string, orderId: string) {
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true, invoice: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.status === 'CANCELLED' || order.status === 'FAILED') {
    throw new ApiError(400, 'Cannot invoice a cancelled order')
  }
  if (order.invoice) return order.invoice

  const subtotal = orderSubtotal(order.lineItems)
  const taxAmount = Number(order.taxAmount ?? 0)
  const totalAmount = Number(order.totalAmount)
  const issuedAt = new Date()

  let dueAt: Date | undefined
  try {
    const customer = await crm.getCustomer(tenantId, order.customerId)
    dueAt = invoiceDueDate(customer.paymentTermsDays, issuedAt)
  } catch {
    dueAt = invoiceDueDate(30, issuedAt)
  }

  const invoice = await orderDb.invoice.create({
    data: {
      tenantId,
      orderId: order.id,
      invoiceNumber: formatInvoiceNumber(order.id),
      customerId: order.customerId,
      subtotal: new Prisma.Decimal(subtotal),
      taxAmount: new Prisma.Decimal(taxAmount),
      totalAmount: new Prisma.Decimal(totalAmount),
      amountPaid: new Prisma.Decimal(order.amountPaid ?? 0),
      issuedAt,
      dueAt,
      status: toStoredInvoiceStatus(
        deriveInvoiceStatus({
          totalAmount,
          amountPaid: Number(order.amountPaid ?? 0),
          amountCredited: 0,
          paymentMethod: order.paymentMethod,
          issuedAt,
        }),
      ) as never,
    },
  })

  const journalEntryId = await postInvoiceJournal(tenantId, invoice.id, totalAmount).catch(() => null)
  if (journalEntryId) {
    return orderDb.invoice.update({
      where: { id: invoice.id },
      data: { journalEntryId },
    })
  }
  return invoice
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

export async function listInvoices(
  tenantId: string,
  page = 1,
  pageSize = 50,
  filters?: { status?: string; customerId?: string },
  opts?: { buyerCustomerId?: string },
) {
  const where: Prisma.InvoiceWhereInput = { tenantId }
  if (opts?.buyerCustomerId) {
    where.customerId = opts.buyerCustomerId
  } else if (filters?.customerId?.trim()) {
    where.customerId = filters.customerId.trim()
  }
  if (filters?.status && filters.status !== 'ALL') {
    where.status = filters.status as never
  }

  const [items, total] = await Promise.all([
    orderDb.invoice.findMany({
      where,
      include: { order: { select: { status: true, paymentMethod: true, channel: true } }, creditMemos: true },
      orderBy: { issuedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
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
    page,
    pageSize,
    hasMore: page * pageSize < total,
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

  const journalEntryId = await postCreditMemoJournal(tenantId, creditMemo.id, creditTotal).catch(() => null)
  if (journalEntryId) {
    await orderDb.creditMemo.update({ where: { id: creditMemo.id }, data: { journalEntryId } })
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
