import { orderTotals, remainingAfterGiftCard } from './order-totals'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-order'
import { inventoryDb, orderDb, tenantDb } from './db'
import { computeSalesTax } from './compliance-tax'
import { getTenantSalesTaxRate } from './tenant-tax'
import { checkCreditLimitForOrder, releaseCreditUsed } from './credit-limit'
import { createApprovalRequest, findPendingApprovalForSubject } from './approvals'
import { ApprovalType } from '@/generated/prisma-tenant'
import { OrderStatus } from '@/generated/prisma-order'
import * as discounts from './discounts'
import { ApiError } from './session'
import { assertCustomerCanTransact } from './crm'
import { runOrderFulfillmentPipeline, cancelOrderWithCompensation } from './order-orchestration'
import { attemptOrQueue, syncInvoiceOrQueue } from './deferred-work'
import { enqueuePostingJob } from './posting-outbox'
import { assertOrderLinePrices } from './pricing'
import * as notifyTriggers from './notification-triggers'
import { assertAgeComplianceForOrder, type PosAgeAttestation } from './compliance-age'
import { defersFulfillmentUntilPayment } from './order-payment-sync'
import { buildPaymentSummary, findPrimaryPaymentIntent } from './order-payment-admin'
import { emitDomainEvent, emitOrderEvent } from './domain-events'
import { allocateOrderNumber, parseOrderNumberQuery } from './order-number'

import { swallowed } from './fire-and-forget'
import { assertWithinBalance, parsePaymentAmount } from './payment-amount'
async function enrichOrderWithPaymentDetails<
  T extends { id: string; paymentIntentId: string | null; totalAmount: unknown; amountPaid: unknown },
>(tenantId: string, order: T) {
  const intent = await findPrimaryPaymentIntent(tenantId, order.id, order.paymentIntentId)
  const { optionalStripeConnectContext } = await import('./tenant-stripe-connect')
  const connectCtx = await optionalStripeConnectContext(tenantId)
  const payment = buildPaymentSummary(order, intent, {
    stripeConnectedAccountId: connectCtx?.connectedAccountId ?? null,
  })
  return { ...order, ...payment }
}

export type CreateOrderInput = {
  customerId: string
  channel: string
  paymentMethod: string
  salesRepId?: string
  priority?: string
  notes?: string
  shippingAddress?: Record<string, unknown>
  /** Required for POS when tenant age verification is enabled and cart has restricted SKUs. */
  ageAttestation?: PosAgeAttestation | null
  discountCode?: string
  giftCardCode?: string
  lineItems: Array<{
    skuId: string
    warehouseId: string
    quantity: number
    unitPrice: number
    preferredBatchId?: string
  }>
}

/** Largest quantity a single order line may carry; far above any real wholesale order. */
export const MAX_LINE_QUANTITY = 1_000_000

/**
 * Every order line must be a whole, positive quantity at a non-negative price. Without this a
 * negative line (e.g. -10 cases) cancels out the cost of real goods: the order totals $0, counts
 * as fully paid, and ships for free while the negative line inflates stock.
 */
export function assertValidOrderLines(lineItems: unknown): asserts lineItems is CreateOrderInput['lineItems'] {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new ApiError(400, 'An order needs at least one line item')
  }
  for (const [i, li] of lineItems.entries()) {
    const line = li as Partial<CreateOrderInput['lineItems'][number]> | null
    const where = `Line ${i + 1}`
    if (!line || typeof line.skuId !== 'string' || !line.skuId.trim()) throw new ApiError(400, `${where}: skuId is required`)
    if (typeof line.warehouseId !== 'string' || !line.warehouseId.trim()) {
      throw new ApiError(400, `${where}: warehouseId is required`)
    }
    if (!Number.isInteger(line.quantity) || (line.quantity as number) < 1 || (line.quantity as number) > MAX_LINE_QUANTITY) {
      throw new ApiError(400, `${where}: quantity must be a whole number from 1 to ${MAX_LINE_QUANTITY}`)
    }
    if (typeof line.unitPrice !== 'number' || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      throw new ApiError(400, `${where}: unitPrice must be a number of 0 or more`)
    }
  }
}

/**
 * Drop-ship is a property of the product: a line ships from its SKU's drop-ship supplier when one
 * is set, and from stock otherwise. What the caller sends is ignored, so nobody can raise a supplier
 * PO by posting DROP_SHIP with a supplier of their choice. Goods handed over on the spot (POS, van
 * sales) always come from stock.
 */
async function dropShipSupplierBySku(tenantId: string, skuIds: string[], stockInHand: boolean) {
  const bySku = new Map<string, string>()
  if (stockInHand) return bySku
  const skus = await inventoryDb.sKU.findMany({
    where: { tenantId, id: { in: [...new Set(skuIds)] }, dropShipSupplierId: { not: null } },
    select: { id: true, dropShipSupplierId: true },
  })
  for (const sku of skus) if (sku.dropShipSupplierId) bySku.set(sku.id, sku.dropShipSupplierId)
  return bySku
}

/**
 * The order for this quote already exists: another conversion committed it first (the database allows one order
 * per quote per tenant). Carries that order's id so the caller links it instead of placing a second one.
 */
export class DuplicateSourceOrderError extends Error {
  constructor(public readonly orderId: string) {
    super('An order for this quote already exists')
  }
}

/** True only for a unique violation on (tenantId, sourceQuoteId), never for the order-number index. */
export function isSourceQuoteConflict(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false
  const target = (e.meta as { target?: unknown } | undefined)?.target
  const names = Array.isArray(target) ? target.map(String) : typeof target === 'string' ? [target] : []
  return names.some((n) => n === 'sourceQuoteId' || n.includes('sourceQuoteId'))
}

/**
 * Runs the single order insert. When it loses the race for a quote's one order (unique violation on
 * (tenantId, sourceQuoteId)), the failed insert has already rolled back: the winning order is read afresh and reported
 * as DuplicateSourceOrderError, before any side effect (discount, approval, pipeline, email) runs for the loser.
 * Every other error, including a duplicate order number, is rethrown unchanged.
 */
async function insertOrderOnce<T>(tenantId: string, sourceQuoteId: string | undefined, insert: () => Promise<T>): Promise<T> {
  try {
    return await insert()
  } catch (e) {
    if (!sourceQuoteId || !isSourceQuoteConflict(e)) throw e
    const winner = await findOrderBySourceQuote(tenantId, sourceQuoteId)
    if (!winner) throw e
    throw new DuplicateSourceOrderError(winner.id)
  }
}

let orderFaultHook: ((point: 'after-insert', orderId: string) => void) | null = null

/**
 * Tests only: run `hook` right after an order row is committed, before anything else createOrder does (discount,
 * approval request, pipeline). Throwing from it simulates a failure after the order exists. Does nothing in production.
 */
export function setOrderFaultForTests(hook: typeof orderFaultHook) {
  orderFaultHook = hook
}

/** The order placed from a quote, if any. Tenant-scoped; read from the order database, the source of truth. */
export async function findOrderBySourceQuote(tenantId: string, quoteId: string) {
  return orderDb.order.findFirst({ where: { tenantId, sourceQuoteId: quoteId } })
}

export async function createOrder(
  tenantId: string,
  dto: CreateOrderInput,
  opts?: {
    buyerCustomerId?: string
    awaitPipeline?: boolean
    userId?: string
    skipPriceValidation?: boolean
    /** POS and van sales: the goods leave with the customer, so no line is drop-shipped. */
    stockInHand?: boolean
    /**
     * Server-only (quote conversion): the quote this order is placed from. Stored in the same insert as the order,
     * where the unique (tenantId, sourceQuoteId) index lets only one order per quote commit. Never from a request body.
     */
    sourceQuoteId?: string
  },
) {
  assertValidOrderLines(dto.lineItems)
  await assertCustomerCanTransact(tenantId, opts?.buyerCustomerId ?? dto.customerId)
  const dropShipSuppliers = await dropShipSupplierBySku(
    tenantId,
    dto.lineItems.map((li) => li.skuId),
    Boolean(opts?.stockInHand),
  )
  const linesTotal = orderTotals(dto.lineItems, { taxRate: 0 }).linesTotal.toNumber()
  let discountRequested = 0
  let discountId: string | null = null

  if (dto.discountCode?.trim()) {
    const validated = await discounts.validateDiscount(tenantId, dto.discountCode, {
      orderSubtotal: linesTotal,
      customerId: opts?.buyerCustomerId ?? dto.customerId,
      requestedBy: opts?.userId,
    })
    if (!validated.valid) throw new ApiError(400, validated.reason)
    if ('pendingApproval' in validated && validated.pendingApproval) {
      throw new ApiError(400, 'Discount is pending manager approval — checkout at full price or wait for approval')
    }
    discountRequested = validated.amountOff
    discountId = validated.discount!.id
  }

  const taxRate = await getTenantSalesTaxRate(tenantId)
  const totals = orderTotals(dto.lineItems, { discount: discountRequested, taxRate })
  const discountAmount = totals.discountAmount.toNumber()
  const totalAmount = totals.totalAmount.toNumber()
  const correlationId = randomUUID()

  const customerId = opts?.buyerCustomerId ?? dto.customerId
  if (opts?.buyerCustomerId && dto.customerId !== opts.buyerCustomerId) {
    throw new ApiError(403, 'Cannot place orders for another customer')
  }

  if (!opts?.skipPriceValidation) {
    await assertOrderLinePrices(tenantId, customerId, dto.lineItems)
  }

  const channel = (dto.channel || 'ADMIN').toUpperCase()
  // Age attestation is only valid for POS counter sales — ignore it elsewhere so
  // clients cannot skip the licensed-customer gate by attaching a fake attestation.
  const ageAttestation = channel === 'POS' ? dto.ageAttestation : undefined

  await assertAgeComplianceForOrder(tenantId, {
    customerId,
    channel,
    lineItems: dto.lineItems,
    userId: opts?.userId,
    posAttestation: ageAttestation,
  })

  let giftCardBalance: number | undefined
  if (dto.giftCardCode?.trim()) {
    const { checkGiftCardBalance } = await import('./gift-cards')
    const balanceCheck = await checkGiftCardBalance(tenantId, dto.giftCardCode.trim())
    if (balanceCheck.valid) giftCardBalance = balanceCheck.balance ?? 0
  }
  const remainingAmountToFinance = remainingAfterGiftCard(totals.totalAmount, giftCardBalance).remaining.toNumber()

  const creditCheck = await checkCreditLimitForOrder(tenantId, customerId, remainingAmountToFinance, dto.paymentMethod)
  const needsCreditApproval = !creditCheck.ok && creditCheck.requiresApproval

  const orderNumber = await allocateOrderNumber(tenantId)
  const order = await insertOrderOnce(tenantId, opts?.sourceQuoteId, () => orderDb.order.create({
    data: {
      tenantId,
      orderNumber,
      ...(opts?.sourceQuoteId ? { sourceQuoteId: opts.sourceQuoteId } : {}),
      customerId,
      channel: channel as never,
      status: needsCreditApproval ? OrderStatus.AWAITING_APPROVAL : undefined,
      paymentMethod: dto.paymentMethod as never,
      salesRepId: dto.salesRepId,
      priority: (dto.priority ?? 'NORMAL') as never,
      notes: dto.notes,
      shippingAddress: dto.shippingAddress as never,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
      lineItems: {
        create: dto.lineItems.map((li) => ({
          skuId: li.skuId,
          warehouseId: li.warehouseId,
          quantity: li.quantity,
          unitPrice: new Prisma.Decimal(li.unitPrice),
          fulfillmentType: dropShipSuppliers.has(li.skuId) ? 'DROP_SHIP' : 'STOCK',
          supplierId: dropShipSuppliers.get(li.skuId) ?? null,
          preferredBatchId: li.preferredBatchId ?? null,
        })),
      },
    },
    include: { lineItems: true },
  }))
  orderFaultHook?.('after-insert', order.id)

  if (discountId && discountAmount > 0) {
    await discounts.redeemDiscount(tenantId, discountId, {
      orderId: order.id,
      customerId,
      amountOff: discountAmount,
    })
  }

  let giftCardRedeemed = 0
  if (dto.giftCardCode?.trim()) {
    const { redeemGiftCard } = await import('./gift-cards')
    const redeemRes = await redeemGiftCard(tenantId, dto.giftCardCode.trim(), {
      amount: totalAmount,
      orderRef: order.id,
    })
    giftCardRedeemed = redeemRes.amountApplied
    if (giftCardRedeemed > 0) {
      const { applyCapturedPayment } = await import('./order-payment-sync')
      await applyCapturedPayment(tenantId, order.id, giftCardRedeemed, { method: 'GIFT_CARD' })
    }
  }

  if (needsCreditApproval && opts?.sourceQuoteId) {
    // Quote orders can be resumed by a retry while this request is still running: one request per order, by id.
    await ensureCreditApprovalRequest(tenantId, order.id, opts?.userId ?? 'system', {
      customerId,
      openBalance: creditCheck.openBalance,
      newOrderTotal: creditCheck.orderTotal,
      creditLimit: creditCheck.creditLimit,
      projectedTotal: creditCheck.projectedTotal,
    })
    return order
  }
  if (needsCreditApproval) {
    const existing = await findPendingApprovalForSubject(
      tenantId,
      ApprovalType.CREDIT_LIMIT_OVERRIDE,
      order.id,
    )
    if (!existing) {
      await createApprovalRequest(tenantId, {
        type: ApprovalType.CREDIT_LIMIT_OVERRIDE,
        subjectId: order.id,
        requestedBy: opts?.userId ?? 'system',
        context: {
          customerId,
          openBalance: creditCheck.openBalance,
          newOrderTotal: creditCheck.orderTotal,
          creditLimit: creditCheck.creditLimit,
          projectedTotal: creditCheck.projectedTotal,
        },
      })
    }
    return order
  }

  const isFullyPaid = giftCardRedeemed >= totalAmount - 0.005
  if (isFullyPaid) {
    await syncInvoiceOrQueue(tenantId, order.id)
  }

  const shouldFulfillNow = !defersFulfillmentUntilPayment(dto.paymentMethod) || isFullyPaid
  if (shouldFulfillNow) {
    if (opts?.awaitPipeline) {
      await runOrderFulfillmentPipeline(order.id, tenantId, correlationId)
    } else {
      void runOrderFulfillmentPipeline(order.id, tenantId, correlationId).catch((err) =>
        console.error(`[orders] fulfillment pipeline failed for order ${order.id}:`, err),
      )
    }
    if (opts?.sourceQuoteId) {
      // A recovery may send this same email concurrently (resumeOrderPlacement): at most one of them delivers.
      void notifyTriggers.notifyOrderCreatedOnce(tenantId, order.id, customerId, totalAmount)
    } else {
      void notifyTriggers.notifyOrderCreated(tenantId, order.id, customerId, totalAmount).catch(swallowed('orders.channel'))
    }
    void emitOrderEvent(tenantId, 'order.created', order.id, {}, { key: order.id })
  }
  return order
}

/** The one credit-override request a quote order can have. Chosen, not random, so concurrent creators collide. */
export const creditApprovalIdFor = (orderId: string) => `credit-override:${orderId}`

/**
 * Makes sure the order has its credit-limit override request, creating it only if none was ever made for the
 * order (pending, decided or cancelled alike: a decided request is never re-raised). Safe under concurrency:
 * the id is fixed per order, so of two creators one insert wins and the other finds it.
 */
async function ensureCreditApprovalRequest(
  tenantId: string,
  orderId: string,
  requestedBy: string,
  context: Record<string, unknown>,
): Promise<{ created: boolean; status: string }> {
  const any = await tenantDb.approvalRequest.findFirst({
    where: { tenantId, type: ApprovalType.CREDIT_LIMIT_OVERRIDE, subjectId: orderId },
    orderBy: { createdAt: 'asc' },
  })
  if (any) return { created: false, status: any.status }
  try {
    const row = await createApprovalRequest(tenantId, {
      id: creditApprovalIdFor(orderId),
      type: ApprovalType.CREDIT_LIMIT_OVERRIDE,
      subjectId: orderId,
      requestedBy,
      context,
    })
    return { created: true, status: row.status }
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
    const winner = await tenantDb.approvalRequest.findFirst({ where: { id: creditApprovalIdFor(orderId), tenantId } })
    if (!winner) throw e
    return { created: false, status: winner.status }
  }
}

/**
 * Past this age a resume sends no order.created webhook or email: webhooks are deduplicated only while their
 * delivery rows are kept (30 days), so stay well inside that.
 */
export const RESUME_NOTICE_MAX_AGE_MS = 7 * 24 * 3_600_000

export type ResumeReport = {
  orderId: string
  /** Order status after the resume. */
  status: string | null
  creditApproval: 'not-needed' | 'created' | 'already-requested' | 'already-decided' | 'failed'
  /** The fulfilment pipeline (reservations, drop-ship POs, warehouse task, confirmation, credit use). */
  pipeline: 'not-needed' | 'already-complete' | 'completed' | 'already-running' | 'skipped' | 'failed'
  /** The customer's "order created" email. Never resent once attempted. */
  email: 'not-needed' | 'sent' | 'failed' | 'already-attempted' | 'not-applicable' | 'skipped'
  /** order.created webhooks: queued once per subscription (deduplicated by order id). */
  event: 'not-needed' | 'emitted' | 'skipped'
  /** What could not be resumed safely, for an operator. Empty when everything is in place. */
  limitations: string[]
}

/**
 * Finishes what placing a quote order left undone when the request stopped after the order was saved (a crash,
 * a lost connection, an error part-way through createOrder). Every step is either idempotent or guarded so it
 * happens at most once, so this is safe to call any number of times, including while the original request is
 * still running:
 * - awaiting credit approval: the order's one override request is created if none was ever made;
 * - otherwise the fulfilment pipeline is run if its saga is missing or unfinished (the saga claim keeps runs
 *   apart; reservations and the warehouse task are only ever topped up, never duplicated), then the
 *   order.created webhook (deduplicated per subscription) and the order-created email (at most once, never
 *   resent once attempted) follow.
 * Discounts and gift cards are never replayed: quote orders have neither, and any other order is refused.
 * Never throws for a step that fails; the report says what happened and what was left for an operator.
 */
export async function resumeOrderPlacement(tenantId: string, orderId: string): Promise<ResumeReport> {
  const report: ResumeReport = {
    orderId,
    status: null,
    creditApproval: 'not-needed',
    pipeline: 'not-needed',
    email: 'not-needed',
    event: 'not-needed',
    limitations: [],
  }
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId }, include: { saga: true } })
  if (!order) {
    report.limitations.push('Order not found for this tenant; nothing was resumed.')
    return report
  }
  report.status = order.status
  if (!order.sourceQuoteId) {
    // Its inputs (discount and gift card codes) are not stored, so its side effects cannot be rebuilt safely.
    report.limitations.push('Only orders placed from a quote can be resumed; this order was left unchanged.')
    return report
  }

  if (order.status === OrderStatus.AWAITING_APPROVAL) {
    try {
      const credit = await checkCreditLimitForOrder(tenantId, order.customerId, Number(order.totalAmount), order.paymentMethod)
      const context = credit.ok
        ? { customerId: order.customerId, newOrderTotal: Number(order.totalAmount), resumed: true }
        : {
            customerId: order.customerId,
            openBalance: credit.openBalance,
            newOrderTotal: credit.orderTotal,
            creditLimit: credit.creditLimit,
            projectedTotal: credit.projectedTotal,
            resumed: true,
          }
      const ensured = await ensureCreditApprovalRequest(tenantId, order.id, 'system', context)
      if (ensured.created) report.creditApproval = 'created'
      else if (ensured.status === 'PENDING') report.creditApproval = 'already-requested'
      else {
        report.creditApproval = 'already-decided'
        // Applying a decision is the approval hook's job; replaying it here could run it twice.
        report.limitations.push(
          `The credit override was already ${ensured.status.toLowerCase()} but the order is still awaiting approval; ` +
            'it was not re-applied and needs an operator.',
        )
      }
    } catch (err) {
      report.creditApproval = 'failed'
      report.limitations.push(`Could not ensure the credit override request: ${errMessage(err)}`)
    }
    // Fulfilment, the webhook and the email wait for the decision (resumeOrderAfterCreditApproval).
    return report
  }

  if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.FAILED) {
    report.limitations.push(`The order is ${order.status.toLowerCase()}; nothing was resumed.`)
    return report
  }

  if (defersFulfillmentUntilPayment(order.paymentMethod)) {
    // Fulfilment for these starts from the payment, not from placement.
    return report
  }

  const sagaStatus = order.saga?.status
  if (sagaStatus === 'COMPLETED') report.pipeline = 'already-complete'
  else if (sagaStatus === 'FAILED' || sagaStatus === 'COMPENSATING') {
    report.pipeline = 'skipped'
    report.limitations.push(`The fulfilment pipeline is ${sagaStatus.toLowerCase()}; it was not re-run.`)
  } else {
    try {
      const outcome = await runOrderFulfillmentPipeline(order.id, tenantId, order.saga?.correlationId ?? randomUUID())
      report.pipeline = outcome === 'COMPLETED' ? 'completed' : outcome === 'ALREADY_RUNNING' ? 'already-running' : 'skipped'
    } catch (err) {
      report.pipeline = 'failed'
      report.limitations.push(`The fulfilment pipeline failed while resuming: ${errMessage(err)}`)
    }
  }

  const now = await orderDb.order.findFirst({ where: { id: orderId, tenantId }, select: { status: true } })
  report.status = now?.status ?? report.status
  if (report.pipeline === 'failed') {
    // Even if the failure's own clean-up could not mark the order FAILED: don't announce an order that didn't go ahead.
    report.limitations.push('No order-created webhook or email was sent because fulfilment failed.')
    return report
  }
  if (!now || now.status === OrderStatus.CANCELLED || now.status === OrderStatus.FAILED) {
    report.limitations.push('The order did not go ahead; no order-created webhook or email was sent.')
    return report
  }

  if (Date.now() - order.createdAt.getTime() > RESUME_NOTICE_MAX_AGE_MS) {
    // Webhook dedupe rows are purged after 30 days, and a weeks-late "order created" email misleads the customer.
    report.event = 'skipped'
    report.email = 'skipped'
    report.limitations.push(
      'The order is too old to tell whether its order.created webhook and email went out; neither was sent.',
    )
    return report
  }
  await emitOrderEvent(tenantId, 'order.created', order.id, {}, { key: order.id })
  report.event = 'emitted'
  report.email = await notifyTriggers.notifyOrderCreatedOnce(tenantId, order.id, order.customerId, Number(order.totalAmount))
  return report
}

function errMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

export async function listOrders(
  tenantId: string,
  page = 1,
  pageSize = 20,
  filters?: {
    status?: string
    channel?: string
    search?: string
    fromIso?: string
    toIso?: string
    customerId?: string
  },
  opts?: { buyerCustomerId?: string },
) {
  const where: Prisma.OrderWhereInput = { tenantId }

  if (opts?.buyerCustomerId) {
    where.customerId = opts.buyerCustomerId
  } else if (filters?.customerId?.trim()) {
    where.customerId = filters.customerId.trim()
  }
  if (filters?.channel && filters.channel !== 'ALL') where.channel = filters.channel as never

  const from = filters?.fromIso ? new Date(filters.fromIso) : null
  const to = filters?.toIso ? new Date(filters.toIso) : null
  if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
    where.createdAt = {}
    if (from && !Number.isNaN(from.getTime())) where.createdAt.gte = from
    if (to && !Number.isNaN(to.getTime())) {
      const end = new Date(to)
      end.setHours(23, 59, 59, 999)
      where.createdAt.lte = end
    }
  }

  if (filters?.search?.trim()) {
    const s = filters.search.trim()
    const byNumber = parseOrderNumberQuery(s)
    where.OR = [
      { id: { contains: s } },
      { customerId: { contains: s } },
      ...(byNumber != null ? [{ orderNumber: byNumber }] : []),
    ]
  }

  const st = filters?.status?.trim()
  if (st && st !== 'ALL') {
    if (st === 'FULFILLED') where.status = { in: ['PROCESSING', 'PACKED'] }
    else where.status = st as never
  }

  const [items, total] = await Promise.all([
    orderDb.order.findMany({
      where,
      include: { lineItems: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    orderDb.order.count({ where }),
  ])
  const customerIds = [...new Set(items.map((i) => i.customerId).filter(Boolean))]
  const { crmDb } = await import('./db')
  const customers =
    customerIds.length > 0
      ? await crmDb.customer.findMany({ where: { tenantId, id: { in: customerIds } } })
      : []
  const custMap = new Map(customers.map((c) => [c.id, c.name]))

  const enrichedItems = items.map((o) => ({
    ...o,
    customerName: custMap.get(o.customerId) ?? null,
  }))

  return { items: enrichedItems, total, page, pageSize, hasMore: page * pageSize < total }
}

export async function findOrderById(tenantId: string, id: string, opts?: { buyerCustomerId?: string }) {
  const order = await orderDb.order.findFirst({
    where: { id, tenantId },
    include: { lineItems: true, saga: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (opts?.buyerCustomerId && order.customerId !== opts.buyerCustomerId) {
    throw new ApiError(404, 'Order not found')
  }

  const skuIds = [...new Set(order.lineItems.map((li) => li.skuId))]
  const { inventoryDb } = await import('./db')
  const skus =
    skuIds.length > 0
      ? await inventoryDb.sKU.findMany({ where: { tenantId, id: { in: skuIds } } })
      : []
  const skuMap = new Map(skus.map((s) => [s.id, s]))

  const enrichedOrder = {
    ...order,
    lineItems: order.lineItems.map((li) => {
      const sku = skuMap.get(li.skuId)
      return {
        ...li,
        skuCode: sku?.code ?? null,
        skuName: sku?.name ?? null,
      }
    }),
  }

  return enrichOrderWithPaymentDetails(tenantId, enrichedOrder)
}

export async function confirmOrder(tenantId: string, id: string) {
  return fulfillOrder(tenantId, id)
}

export async function fulfillOrder(tenantId: string, id: string) {
  const order = await findOrderById(tenantId, id)
  if (!['PENDING', 'CONFIRMED', 'BACKORDERED', 'PROCESSING'].includes(order.status)) {
    throw new ApiError(400, `Order cannot be fulfilled from status ${order.status}`)
  }
  const correlationId = order.saga?.correlationId ?? randomUUID()
  await runOrderFulfillmentPipeline(id, tenantId, correlationId)
  return findOrderById(tenantId, id)
}

export async function listShippedOrdersForDispatch(tenantId: string) {
  return orderDb.order.findMany({
    where: { tenantId, status: 'SHIPPED' },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      status: true,
      totalAmount: true,
      shippingAddress: true,
      notes: true,
      updatedAt: true,
    },
  })
}

export async function recordOrderPayment(
  tenantId: string,
  id: string,
  body: { amount: number | string; method: string; reference?: string },
) {
  const apply = parsePaymentAmount(body.amount)
  const order = await findOrderById(tenantId, id)
  const total = new Prisma.Decimal(order.totalAmount)
  const paidSoFar = new Prisma.Decimal(order.amountPaid ?? 0)
  const remaining = total.minus(paidSoFar)
  if (remaining.lte(0)) throw new ApiError(400, 'Order is already fully paid')
  assertWithinBalance(apply, remaining)

  // Compare-and-set on the total and paid amount the checks above used. If another payment or a
  // credit memo changed either one since, nothing is written, and none of the side effects below run.
  const moved = await orderDb.order.updateMany({
    where: { id, tenantId, totalAmount: total, amountPaid: paidSoFar },
    data: { amountPaid: paidSoFar.plus(apply) },
  })
  if (moved.count !== 1) {
    throw new ApiError(409, 'The balance changed while this payment was being recorded. Refresh and try again.')
  }
  // From here on the payment is recorded. The follow-up work lives in other databases (or the
  // outbox) and cannot share this write; each step retries on its own rather than undoing it.
  const updated = await orderDb.order.findFirstOrThrow({ where: { id, tenantId }, include: { lineItems: true } })

  if (order.paymentMethod === 'NET_TERMS') {
    await attemptOrQueue(
      {
        tenantId,
        kind: 'CREDIT_RELEASE',
        sourceType: 'Order',
        sourceId: id,
        payload: { customerId: order.customerId, amount: apply.toString() },
      },
      () => releaseCreditUsed(tenantId, order.customerId, Number(apply)),
    )
  }
  // Manual payments (cash, check, ACH entered by staff) don't go through card capture.
  void emitOrderEvent(tenantId, 'finance.payment_captured', id, {
    amount: Number(apply),
    paymentIntentId: null,
    method: body.method,
    reference: body.reference ?? null,
  })

  await syncInvoiceOrQueue(tenantId, id)

  const invoice = await orderDb.invoice.findFirst({ where: { tenantId, orderId: id } })
  if (invoice) {
    // Queued with the payment's reference (or a fresh key), so the journal posts once and a ledger
    // problem shows up as a failing job rather than a payment missing from the books.
    await enqueuePostingJob(orderDb, {
      tenantId,
      kind: 'AR_PAYMENT_JOURNAL',
      sourceType: 'Invoice',
      sourceId: invoice.id,
      variant: `manual:${body.reference?.trim() || randomUUID()}`,
      amount: apply.toFixed(2),
    })
    const { notifyPaymentReceived } = await import('./notification-triggers')
    void notifyPaymentReceived(tenantId, id, order.customerId, Number(apply), invoice.invoiceNumber).catch(
      () => undefined,
    )
  }

  return updated
}

export async function cancelOrder(tenantId: string, id: string, reason: string) {
  return cancelOrderWithCompensation(tenantId, id, reason)
}

export async function resumeOrderAfterCreditApproval(tenantId: string, orderId: string) {
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.status !== OrderStatus.AWAITING_APPROVAL) return order

  const correlationId = randomUUID()
  await orderDb.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.PENDING },
  })

  if (!defersFulfillmentUntilPayment(order.paymentMethod)) {
    await runOrderFulfillmentPipeline(orderId, tenantId, correlationId)
    if (order.sourceQuoteId) {
      // Quote orders may also be resumed by resumeOrderPlacement: at most one of the two sends the email.
      void notifyTriggers.notifyOrderCreatedOnce(tenantId, orderId, order.customerId, Number(order.totalAmount))
    } else {
      void notifyTriggers.notifyOrderCreated(
        tenantId,
        orderId,
        order.customerId,
        Number(order.totalAmount),
      ).catch(swallowed('orders.resumeOrderAfterCreditApproval'))
    }
    void emitOrderEvent(tenantId, 'order.created', orderId, {}, { key: orderId })
  }
  return orderDb.order.findFirst({ where: { id: orderId, tenantId }, include: { lineItems: true } })
}

export async function getReorderLines(tenantId: string, orderId: string, opts?: { buyerCustomerId?: string }) {
  const order = await findOrderById(tenantId, orderId, opts)
  const { resolvePricesForCustomer } = await import('./pricing')
  const skuIds = order.lineItems.map((li) => li.skuId)
  const prices = await resolvePricesForCustomer(tenantId, order.customerId, skuIds)
  const skus = await import('./inventory').then((m) =>
    Promise.all(skuIds.map((id) => m.findSkuById(tenantId, id).catch((err) => { swallowed('orders.getReorderLines.sku', { tenantId, level: 'warn' })(err); return null }))),
  )
  const skuMap = new Map(skus.filter(Boolean).map((s) => [s!.id, s!]))

  return order.lineItems.map((li) => {
    const sku = skuMap.get(li.skuId)
    const resolved = prices.get(li.skuId)
    const unitPrice = resolved?.unitPrice ?? Number(li.unitPrice)
    return {
      skuId: li.skuId,
      skuCode: sku?.code ?? li.skuId.slice(0, 12),
      skuName: sku?.name ?? li.skuId.slice(0, 12),
      warehouseId: li.warehouseId,
      quantity: li.quantity,
      unitPrice,
      listPrice: sku ? Number(sku.price) : Number(li.unitPrice),
      priceSource: resolved?.source ?? 'list',
    }
  })
}
