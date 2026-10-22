/**
 * Sales rep app (PLR-170): a rep's own accounts and leads, quotes and orders at the customer's
 * prices, and credit-limit requests that a manager approves.
 *
 * A rep sees only their own accounts (managers see all) and sends only item + quantity; prices
 * always come from the server, so a rep cannot quote or sell below what the customer is owed.
 */
import { ApprovalType } from '@/generated/prisma-tenant'
import { crmDb, inventoryDb, orderDb, tenantDb } from './db'
import * as crm from './crm'
import { createApprovalRequest, findPendingApprovalForSubject } from './approvals'
import { auditLog } from './audit-log'
import { createOrder } from './orders'
import { createQuote } from './quotes'
import { resolvePricesForCustomer } from './pricing'
import { invoiceBalance } from './invoice-status'
import { isManagerRole } from './pick-claim'
import {
  availableCredit,
  canSeeAccount,
  canWorkLead,
  creditRequestProblem,
  leadIsOpen,
  repLinesProblem,
  type RepViewer,
} from './rep-rules'
import { ApiError } from './session'

const num = (v: unknown) => (v == null ? 0 : Number(v))

/** Open receivable per customer, in one query. */
async function openBalances(tenantId: string, customerIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>(customerIds.map((id) => [id, 0]))
  if (customerIds.length === 0) return out
  const rows = await orderDb.invoice.findMany({
    where: { tenantId, customerId: { in: customerIds }, order: { status: { notIn: ['CANCELLED', 'FAILED'] } } },
    select: { customerId: true, totalAmount: true, amountPaid: true, amountCredited: true },
  })
  for (const r of rows) {
    out.set(r.customerId, (out.get(r.customerId) ?? 0) + invoiceBalance(num(r.totalAmount), num(r.amountPaid), num(r.amountCredited)))
  }
  for (const [k, v] of out) out.set(k, Math.round(v * 100) / 100)
  return out
}

export async function listAccounts(
  tenantId: string,
  viewer: RepViewer,
  opts: { scope?: string; q?: string; take?: number } = {},
) {
  const mineOnly = !isManagerRole(viewer.role) || opts.scope === 'mine'
  const q = opts.q?.trim()
  const rows = await crmDb.customer.findMany({
    where: {
      tenantId,
      ...(mineOnly ? { salesRepUserId: viewer.userId } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {}),
    },
    orderBy: { name: 'asc' },
    take: Math.min(Math.max(opts.take ?? 100, 1), 200),
  })
  const balances = await openBalances(tenantId, rows.map((r) => r.id))
  return rows.map((c) => {
    const limit = c.creditLimit != null ? num(c.creditLimit) : null
    const balance = balances.get(c.id) ?? 0
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      city: c.primaryCity,
      state: c.primaryState,
      salesRepUserId: c.salesRepUserId,
      creditLimit: limit,
      openBalance: balance,
      availableCredit: availableCredit(limit, balance),
    }
  })
}

/** The account, or a 404 when it is not this rep's (so ids of other accounts are not confirmed). */
async function accountFor(tenantId: string, viewer: RepViewer, customerId: string) {
  const customer = await crmDb.customer.findFirst({ where: { id: customerId, tenantId } })
  if (!customer || !canSeeAccount(viewer, customer.salesRepUserId)) throw new ApiError(404, 'Customer not found')
  return customer
}

export async function accountDetail(tenantId: string, viewer: RepViewer, customerId: string) {
  const c = await accountFor(tenantId, viewer, customerId)
  const [balances, orders, invoices, activities, pending] = await Promise.all([
    openBalances(tenantId, [c.id]),
    orderDb.order.findMany({
      where: { tenantId, customerId: c.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, status: true, totalAmount: true, channel: true, paymentMethod: true, createdAt: true, salesRepId: true },
    }),
    orderDb.invoice.findMany({
      where: { tenantId, customerId: c.id, status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, order: { status: { notIn: ['CANCELLED', 'FAILED'] } } },
      orderBy: { issuedAt: 'desc' },
      take: 20,
      select: { id: true, invoiceNumber: true, totalAmount: true, amountPaid: true, amountCredited: true, issuedAt: true, dueAt: true },
    }),
    crmDb.activity.findMany({ where: { tenantId, customerId: c.id }, orderBy: { occurredAt: 'desc' }, take: 20 }),
    findPendingApprovalForSubject(tenantId, ApprovalType.CREDIT_LIMIT_INCREASE, c.id),
  ])
  const limit = c.creditLimit != null ? num(c.creditLimit) : null
  const balance = balances.get(c.id) ?? 0
  return {
    customer: {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      address: [c.primaryAddressLine1, c.primaryCity, c.primaryState, c.primaryZip].filter(Boolean).join(', '),
      salesRepUserId: c.salesRepUserId,
      paymentTermsDays: c.paymentTermsDays,
    },
    credit: { creditLimit: limit, openBalance: balance, availableCredit: availableCredit(limit, balance) },
    pendingCreditRequest: pending
      ? { id: pending.id, context: pending.context, createdAt: pending.createdAt }
      : null,
    recentOrders: orders.map((o) => ({ ...o, totalAmount: num(o.totalAmount) })),
    openInvoices: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      issuedAt: i.issuedAt,
      dueAt: i.dueAt,
      total: num(i.totalAmount),
      balance: invoiceBalance(num(i.totalAmount), num(i.amountPaid), num(i.amountCredited)),
    })),
    timeline: activities,
  }
}

/** Items the rep may put on a quote or order, with the customer's own prices. */
async function priceLines(tenantId: string, customerId: string, lines: Array<{ skuId: string; quantity: number }>) {
  const ids = lines.map((l) => l.skuId)
  const skus = await inventoryDb.sKU.findMany({ where: { tenantId, id: { in: ids }, isActive: true } })
  const byId = new Map(skus.map((s) => [s.id, s]))
  for (const l of lines) if (!byId.has(l.skuId)) throw new ApiError(404, 'An item on this list is not available')
  const prices = await resolvePricesForCustomer(tenantId, customerId, ids, new Map(lines.map((l) => [l.skuId, l.quantity])))
  return lines.map((l) => {
    const sku = byId.get(l.skuId)!
    const price = prices.get(l.skuId)?.unitPrice
    if (price == null) throw new ApiError(422, `No price for ${sku.code}`)
    return { skuId: l.skuId, code: sku.code, name: sku.name, quantity: l.quantity, unitPrice: price }
  })
}

export async function quoteForAccount(
  tenantId: string,
  viewer: RepViewer,
  customerId: string,
  body: { lines?: unknown; notes?: unknown },
) {
  const problem = repLinesProblem(body.lines)
  if (problem) throw new ApiError(400, problem)
  await accountFor(tenantId, viewer, customerId)
  const priced = await priceLines(tenantId, customerId, body.lines as Array<{ skuId: string; quantity: number }>)
  const quote = await createQuote(tenantId, {
    customerRef: customerId,
    notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : undefined,
    lines: priced.map((p, i) => ({ lineNo: i + 1, skuCode: p.code, description: p.name, qty: p.quantity, unitPrice: p.unitPrice })),
  })
  await auditLog(tenantId, { userId: viewer.userId, action: 'rep.quote_created', entityType: 'B2BQuote', entityId: quote.id, metadata: { customerId } })
  return quote
}

const REP_PAYMENT_METHODS = ['NET_TERMS', 'CASH', 'CHECK']

export async function orderForAccount(
  tenantId: string,
  viewer: RepViewer,
  customerId: string,
  body: { lines?: unknown; paymentMethod?: unknown; notes?: unknown },
) {
  const problem = repLinesProblem(body.lines)
  if (problem) throw new ApiError(400, problem)
  const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.toUpperCase() : 'NET_TERMS'
  if (!REP_PAYMENT_METHODS.includes(paymentMethod)) throw new ApiError(400, 'Payment must be net terms, cash or check')
  await accountFor(tenantId, viewer, customerId)

  const warehouses = await inventoryDb.warehouse.findMany({ where: { tenantId, isActive: true, kind: 'WAREHOUSE' } })
  const wh = warehouses.find((w) => w.isDefault) ?? warehouses[0]
  if (!wh) throw new ApiError(400, 'No warehouse configured')

  const priced = await priceLines(tenantId, customerId, body.lines as Array<{ skuId: string; quantity: number }>)
  const order = await createOrder(
    tenantId,
    {
      customerId,
      channel: 'SALES_REP',
      paymentMethod,
      salesRepId: viewer.userId,
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : undefined,
      lineItems: priced.map((p) => ({ skuId: p.skuId, warehouseId: wh.id, quantity: p.quantity, unitPrice: p.unitPrice })),
    },
    { userId: viewer.userId },
  )
  return { order, awaitingApproval: order.status === 'AWAITING_APPROVAL' }
}

export async function requestCreditIncrease(
  tenantId: string,
  viewer: RepViewer,
  customerId: string,
  body: { requestedLimit?: unknown; reason?: unknown },
) {
  const c = await accountFor(tenantId, viewer, customerId)
  const current = c.creditLimit != null ? num(c.creditLimit) : null
  const problem = creditRequestProblem(body, current)
  if (problem) throw new ApiError(400, problem)
  if (await findPendingApprovalForSubject(tenantId, ApprovalType.CREDIT_LIMIT_INCREASE, c.id)) {
    throw new ApiError(409, 'A credit request for this account is already waiting for approval')
  }
  const request = await createApprovalRequest(tenantId, {
    type: ApprovalType.CREDIT_LIMIT_INCREASE,
    subjectId: c.id,
    requestedBy: viewer.userId,
    context: {
      customerId: c.id,
      customerName: c.name,
      currentLimit: current,
      requestedLimit: Number(body.requestedLimit),
      reason: String(body.reason).trim(),
    },
  })
  await auditLog(tenantId, { userId: viewer.userId, action: 'credit_limit.requested', entityType: 'Customer', entityId: c.id, metadata: { requestId: request.id } })
  return request
}

/** Called when a manager approves: the account's limit becomes what was asked for. */
export async function applyApprovedCreditIncrease(tenantId: string, request: { id: string; subjectId: string; context: unknown; decidedBy: string | null }) {
  const ctx = (request.context ?? {}) as { requestedLimit?: number; currentLimit?: number | null }
  const next = Number(ctx.requestedLimit)
  if (!Number.isFinite(next) || next <= 0) throw new ApiError(500, 'Credit request has no limit')
  await crmDb.customer.update({ where: { id: request.subjectId }, data: { creditLimit: next } })
  await auditLog(tenantId, {
    userId: request.decidedBy ?? undefined,
    action: 'credit_limit.changed',
    entityType: 'Customer',
    entityId: request.subjectId,
    metadata: { from: ctx.currentLimit ?? null, to: next, requestId: request.id },
  })
}

export async function listCreditRequests(tenantId: string, viewer: RepViewer) {
  return tenantDb.approvalRequest.findMany({
    where: { tenantId, type: ApprovalType.CREDIT_LIMIT_INCREASE, ...(isManagerRole(viewer.role) ? {} : { requestedBy: viewer.userId }) },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

export async function listRepLeads(tenantId: string, viewer: RepViewer) {
  return crmDb.lead.findMany({
    where: {
      tenantId,
      ...(isManagerRole(viewer.role) ? {} : { OR: [{ assignedToUserId: viewer.userId }, { assignedToUserId: null }] }),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
}

export function createRepLead(tenantId: string, viewer: RepViewer, dto: Record<string, unknown>) {
  if (typeof dto.companyName !== 'string' || !dto.companyName.trim()) throw new ApiError(400, 'Company name is required')
  return crm.createLead(tenantId, { ...dto, companyName: dto.companyName.trim(), assignedToUserId: viewer.userId })
}

async function leadFor(tenantId: string, viewer: RepViewer, id: string) {
  const lead = await crmDb.lead.findFirst({ where: { id, tenantId } })
  if (!lead || !canWorkLead(viewer, lead.assignedToUserId)) throw new ApiError(404, 'Lead not found')
  return lead
}

/** Take an unowned lead. Compare-and-set, so two reps cannot both get it. */
export async function claimLead(tenantId: string, viewer: RepViewer, id: string) {
  const lead = await leadFor(tenantId, viewer, id)
  if (lead.assignedToUserId === viewer.userId) return lead
  const res = await crmDb.lead.updateMany({
    where: { id, tenantId, assignedToUserId: lead.assignedToUserId },
    data: { assignedToUserId: viewer.userId },
  })
  if (res.count === 0) throw new ApiError(409, 'Someone else just took this lead')
  return crmDb.lead.findFirstOrThrow({ where: { id, tenantId } })
}

export async function setLeadStatus(tenantId: string, viewer: RepViewer, id: string, status: unknown) {
  await leadFor(tenantId, viewer, id)
  return crm.patchLead(tenantId, id, { status })
}

/** Turn a lead into a customer owned by the rep who worked it. */
export async function convertRepLead(tenantId: string, viewer: RepViewer, id: string, name?: string) {
  const lead = await leadFor(tenantId, viewer, id)
  if (!leadIsOpen(lead.status)) throw new ApiError(400, 'Cannot convert a closed lead')
  const converted = await crm.convertLead(tenantId, id, name?.trim() || lead.companyName)
  const owner = lead.assignedToUserId ?? (isManagerRole(viewer.role) ? null : viewer.userId)
  if (converted.customerId && owner) {
    await crmDb.customer.update({ where: { id: converted.customerId }, data: { salesRepUserId: owner } })
  }
  return converted
}

/** Items to pick from, each at this customer's price. */
export async function catalogForAccount(tenantId: string, viewer: RepViewer, customerId: string, q?: string) {
  await accountFor(tenantId, viewer, customerId)
  const term = q?.trim()
  const skus = await inventoryDb.sKU.findMany({
    where: { tenantId, isActive: true, ...(term ? { OR: [{ code: { contains: term } }, { name: { contains: term } }, { barcode: { contains: term } }] } : {}) },
    orderBy: { name: 'asc' },
    take: 30,
    select: { id: true, code: true, name: true, price: true },
  })
  const prices = await resolvePricesForCustomer(tenantId, customerId, skus.map((s) => s.id))
  return skus.map((s) => {
    const p = prices.get(s.id)
    return { id: s.id, code: s.code, name: s.name, listPrice: num(s.price), unitPrice: p?.unitPrice ?? num(s.price), source: p?.source ?? 'list' }
  })
}
