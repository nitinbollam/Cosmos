import { isPortalBuyer, requirePortalCustomerId } from '../buyer-context'
import * as orders from '../orders'
import * as orderShipments from '../order-shipments'
import * as orderTemplates from '../order-templates'
import * as backorders from '../backorders'
import * as dropShip from '../drop-ship'
import * as invoices from '../invoices'
import * as quotes from '../quotes'
import * as crm from '../crm'
import * as orderPaymentAdmin from '../order-payment-admin'
import * as approvals from '../approvals'
import { ApprovalType } from '@/generated/prisma-tenant'
import { isOrderCancellationEligible } from '../order-status'
import { ApiError, requireSession, requirePermission, assertPermission, assertRole, ADMIN_ROLES, requireIdempotencyKey } from './common'

export async function routeOrders(method: string, seg: string[], req: Request): Promise<Response> {
  const url = new URL(req.url)
  const adminAction =
    seg.length === 3 &&
    method === 'POST' &&
    (seg[2] === 'confirm' ||
      seg[2] === 'fulfill' ||
      seg[2] === 'cancel' ||
      seg[2] === 'returns')
  const session = adminAction ? await requirePermission(req, 'orders.write') : await requireSession(req)
  const buyerCustomerId = isPortalBuyer(session.role)
    ? await requirePortalCustomerId(session)
    : undefined
  const buyerOpts = buyerCustomerId ? { buyerCustomerId } : undefined

  if (seg.length === 3 && seg[2] === 'cancellation-requests') {
    if (!buyerCustomerId || !isPortalBuyer(session.role)) {
      throw new ApiError(403, 'Only an authenticated buyer can request cancellation')
    }
    const order = await orders.findOrderById(session.tenantId, seg[1], buyerOpts)
    if (method === 'GET') {
      return Response.json({
        request: await approvals.findLatestApprovalForSubject(
          session.tenantId,
          ApprovalType.ORDER_CANCELLATION,
          order.id,
        ),
      })
    }
    if (method === 'POST') {
      const body = (await req.json()) as { reason?: string }
      const reason = body.reason?.trim()
      if (!reason) throw new ApiError(400, 'Please provide a reason for your cancellation request')
      if (reason.length > 500) throw new ApiError(400, 'Cancellation reason must be 500 characters or fewer')
      if (!isOrderCancellationEligible(order.status)) {
        throw new ApiError(400, `Cancellation requests are unavailable once an order is ${order.status.toLowerCase()}`)
      }
      const result = await approvals.createPendingApprovalRequest(session.tenantId, {
        type: ApprovalType.ORDER_CANCELLATION,
        subjectId: order.id,
        requestedBy: session.userId,
        context: { reason, orderNumber: order.orderNumber, orderStatus: order.status },
      })
      return Response.json(result, { status: result.duplicate ? 200 : 201 })
    }
  }

  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as orders.CreateOrderInput
    // The checkout sends an Idempotency-Key; honour it so a retry after a timeout returns the
    // order already placed instead of creating (and charging) a second one.
    const placeOnce = (create: () => Promise<unknown>) => placeOrderOnce(req, session, create)
    // Portal buyers cannot spoof POS channel or supply staff age attestation to
    // skip the licensed-customer gate for tobacco / age-restricted SKUs.
    if (buyerCustomerId) {
      const safeBody: orders.CreateOrderInput = {
        ...body,
        channel: 'B2B_PORTAL',
        ageAttestation: undefined,
      }
      return placeOnce(() =>
        orders.createOrder(session.tenantId, safeBody, {
          ...buyerOpts,
          userId: session.userId,
        }),
      )
    }
    // Counter sales must go through /pos/orders so register + attestation rules apply.
    if (String(body.channel ?? '').toUpperCase() === 'POS') {
      throw new ApiError(400, 'POS sales must use POST /pos/orders')
    }
    return placeOnce(() =>
      orders.createOrder(session.tenantId, { ...body, ageAttestation: undefined }, { ...buyerOpts, userId: session.userId }),
    )
  }
  if (seg.length === 2 && seg[1] === 'backorders' && method === 'GET') {
    return Response.json(await backorders.listOpenBackorders(session.tenantId, +(url.searchParams.get('limit') ?? 50)))
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await orders.findOrderById(session.tenantId, seg[1], buyerOpts))
  }
  if (seg.length === 1 && method === 'GET') {
    return Response.json(
      await orders.listOrders(
        session.tenantId,
        +(url.searchParams.get('page') ?? 1),
        +(url.searchParams.get('pageSize') ?? 20),
        {
          status: url.searchParams.get('status') ?? undefined,
          channel: url.searchParams.get('channel') ?? undefined,
          search: url.searchParams.get('search') ?? url.searchParams.get('q') ?? undefined,
          fromIso: url.searchParams.get('from') ?? undefined,
          toIso: url.searchParams.get('to') ?? undefined,
          customerId: buyerCustomerId ? undefined : url.searchParams.get('customerId') ?? undefined,
        },
        buyerOpts,
      ),
    )
  }
  if (seg.length === 3 && seg[2] === 'confirm' && method === 'POST') {
    return Response.json(await orders.confirmOrder(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'fulfill' && method === 'POST') {
    return Response.json(await orders.fulfillOrder(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'cancel' && method === 'POST') {
    const body = (await req.json()) as { reason?: string }
    if (!body.reason) throw new ApiError(400, 'reason is required')
    return Response.json(await orders.cancelOrder(session.tenantId, seg[1], body.reason))
  }
  if (seg.length === 3 && seg[2] === 'invoice' && method === 'GET') {
    return Response.json(await invoices.getInvoiceByOrderId(session.tenantId, seg[1], buyerOpts))
  }
  if (seg.length === 3 && seg[2] === 'reorder-lines' && method === 'GET') {
    return Response.json(await orders.getReorderLines(session.tenantId, seg[1], buyerOpts))
  }
  if (seg.length === 3 && seg[2] === 'tracking' && method === 'GET') {
    return Response.json(await orderShipments.getOrderTracking(session.tenantId, seg[1], buyerOpts))
  }
  if (seg.length === 3 && seg[2] === 'shipments' && method === 'GET') {
    // Ownership check: buyers may only see shipments for their own orders.
    if (buyerOpts) await orders.findOrderById(session.tenantId, seg[1], buyerOpts)
    return Response.json(await orderShipments.listOrderShipments(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'shipments' && method === 'POST') {
    await requirePermission(req, 'orders.write')
    const body = (await req.json()) as Parameters<typeof orderShipments.createOrderShipments>[2]
    return Response.json(await orderShipments.createOrderShipments(session.tenantId, seg[1], body), { status: 201 })
  }
  if (seg.length === 3 && seg[2] === 'returns' && method === 'POST') {
    const body = (await req.json()) as Omit<invoices.ApplyCreditMemoInput, 'orderId'>
    return Response.json(
      await invoices.applyCreditMemo(session.tenantId, { ...body, orderId: seg[1] }, session.userId),
    )
  }
  if (seg.length === 3 && seg[2] === 'payments' && method === 'POST') {
    // Same rule as invoice payments: recording money received outside the app is staff work.
    if (isPortalBuyer(session.role)) throw new ApiError(403, 'Only finance staff can record a payment received outside the app. Pay by card instead.')
    assertPermission(session, 'orders.write')
    const body = (await req.json()) as { amount: number; method: string; reference?: string }
    return Response.json(await orders.recordOrderPayment(session.tenantId, seg[1], body))
  }
  if (seg.length === 4 && seg[2] === 'drop-ship' && seg[3] === 'ship' && method === 'POST') {
    await requirePermission(req, 'orders.write')
    const body = (await req.json()) as { carrier?: string; trackingNumber?: string }
    return Response.json(await dropShip.markDropShipLinesShipped(session.tenantId, seg[1], body))
  }
  if (seg.length === 4 && seg[2] === 'drop-ship' && seg[3] === 'create-po' && method === 'POST') {
    await requirePermission(req, 'orders.write')
    return Response.json(await dropShip.createDropShipPurchaseOrders(session.tenantId, seg[1]))
  }
  if (seg.length === 4 && seg[2] === 'payments' && method === 'POST') {
    assertRole(session, ADMIN_ROLES)
    const key = requireIdempotencyKey(req)
    const body = (await req.json()) as {
      paymentMethodId?: string
      amount?: number
      correlationId: string
      customerId?: string
    }
    const order = await orders.findOrderById(session.tenantId, seg[1])
    const action = seg[3]
    // Each payment action runs once per Idempotency-Key: a retry gets the first result instead of
    // charging, refunding or capturing again.
    const once = async (work: () => Promise<unknown>) => {
      const { runOnce } = await import('../payment-idempotency')
      const result = await runOnce(session.tenantId, `payment:order:${seg[1]}:${action}:${session.userId}:${key}`, 200, work)
      return Response.json(result.body, { status: result.status })
    }
    if (action === 'stripe') {
      if (!body.paymentMethodId || !body.correlationId) {
        throw new ApiError(400, 'paymentMethodId and correlationId required')
      }
      const paymentMethodId = body.paymentMethodId
      return once(() =>
        orderPaymentAdmin.collectOrderCardPayment(session.tenantId, seg[1], {
          paymentMethodId,
          amount: body.amount,
          correlationId: body.correlationId,
          customerId: body.customerId ?? order.customerId,
        }),
      )
    }
    if (action === 'confirm-stripe') {
      const piId = (body as { paymentIntentId?: string }).paymentIntentId
      if (!piId) throw new ApiError(400, 'paymentIntentId required')
      return once(() => orderPaymentAdmin.completeOrderCardCollection(session.tenantId, seg[1], piId))
    }
    if (action === 'refund') {
      return once(() =>
        orderPaymentAdmin.refundOrderPayment(session.tenantId, seg[1], body.correlationId, body.amount),
      )
    }
    if (action === 'capture') {
      return once(() => orderPaymentAdmin.captureOrderPayment(session.tenantId, seg[1], body.correlationId))
    }
    if (action === 'void') {
      return once(() => orderPaymentAdmin.voidOrderPayment(session.tenantId, seg[1], body.correlationId))
    }
    throw new ApiError(404, 'Order payment action not found')
  }
  throw new ApiError(404, 'Order route not found')
}

export async function routeQuotes(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const url = new URL(req.url)
  const buyerCustomerId = isPortalBuyer(session.role)
    ? await requirePortalCustomerId(session)
    : undefined
  const buyerOpts = buyerCustomerId ? { buyerCustomerId } : undefined

  if (seg.length === 1 && method === 'GET') {
    const status = url.searchParams.get('status') ?? undefined
    return Response.json(await quotes.listQuotes(session.tenantId, status, buyerOpts))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof quotes.createQuote>[1]
    return Response.json(await quotes.createQuote(session.tenantId, body, buyerOpts), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await quotes.getQuote(session.tenantId, seg[1], buyerOpts))
  }
  if (seg.length === 3 && seg[2] === 'submit' && method === 'POST') {
    const byEmail = session.email
      ? await crm.findCustomerByEmail(session.tenantId, session.email)
      : null
    return Response.json(
      await quotes.submitQuote(session.tenantId, seg[1], byEmail?.id, buyerOpts),
    )
  }
  if (seg.length === 3 && seg[2] === 'request-approval' && method === 'POST') {
    return Response.json(await quotes.requestQuoteApproval(session.tenantId, seg[1], buyerOpts))
  }
  if (seg.length === 3 && seg[2] === 'approve' && method === 'POST') {
    await requirePermission(req, 'quotes.write')
    return Response.json(await quotes.approveQuote(session.tenantId, seg[1], session.userId))
  }
  if (seg.length === 3 && seg[2] === 'reject' && method === 'POST') {
    await requirePermission(req, 'quotes.write')
    const body = (await req.json()) as { reason?: string }
    if (!body.reason?.trim()) throw new ApiError(400, 'reason is required')
    return Response.json(await quotes.rejectQuote(session.tenantId, seg[1], body.reason))
  }
  if (seg.length === 3 && seg[2] === 'counter-offers' && method === 'GET') {
    // Ownership check: buyers may only see counter-offers on their own quotes.
    if (buyerOpts) await quotes.getQuote(session.tenantId, seg[1], buyerOpts)
    return Response.json(await quotes.listQuoteCounterOffers(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'counter-offers' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof quotes.createQuoteCounterOffer>[2]
    return Response.json(
      await quotes.createQuoteCounterOffer(session.tenantId, seg[1], body, buyerOpts),
      { status: 201 },
    )
  }
  if (seg.length === 4 && seg[2] === 'counter-offers' && seg[3] === 'accept' && method === 'POST') {
    if (buyerOpts) await quotes.getQuote(session.tenantId, seg[1], buyerOpts)
    const body = (await req.json()) as { counterOfferId?: string }
    if (!body.counterOfferId) throw new ApiError(400, 'counterOfferId required')
    return Response.json(await quotes.acceptQuoteCounterOffer(session.tenantId, seg[1], body.counterOfferId))
  }
  throw new ApiError(404, 'Quote route not found')
}

export async function routeOrderTemplates(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const buyerCustomerId = isPortalBuyer(session.role) ? await requirePortalCustomerId(session) : undefined
  const buyerOpts = buyerCustomerId ? { buyerCustomerId } : undefined
  // Staff work on any customer's templates with the same rights as orders. A buyer only ever
  // gets their own: the customer comes from their login, never from the request.
  if (!buyerCustomerId) assertPermission(session, method === 'GET' ? 'orders.read' : 'orders.write')
  const customerRef = buyerCustomerId ?? new URL(req.url).searchParams.get('customerRef')

  if (seg.length === 1 && method === 'GET') {
    if (!customerRef) throw new ApiError(400, 'customerRef required')
    return Response.json(await orderTemplates.listOrderTemplates(session.tenantId, customerRef))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof orderTemplates.createOrderTemplate>[1]
    return Response.json(await orderTemplates.createOrderTemplate(session.tenantId, body, buyerOpts), { status: 201 })
  }
  if (seg.length === 3 && seg[2] === 'cart-lines' && method === 'GET') {
    if (!buyerCustomerId) throw new ApiError(403, 'Buyer account required')
    return Response.json(await orderTemplates.templateToCartLines(session.tenantId, seg[1], buyerCustomerId))
  }
  if (seg.length === 2 && method === 'DELETE') {
    return Response.json(await orderTemplates.deleteOrderTemplate(session.tenantId, seg[1], buyerOpts))
  }
  throw new ApiError(404, 'Order template route not found')
}

/**
 * Run `create` at most once per (user, Idempotency-Key). Without a key the request behaves as
 * before. A duplicate that arrives while the first is still running gets 409; one that arrives
 * afterwards gets the original response.
 */
export async function placeOrderOnce(
  req: Request,
  session: { tenantId: string; userId: string },
  create: () => Promise<unknown>,
): Promise<Response> {
  const header = req.headers.get('idempotency-key')?.trim()
  if (!header) return Response.json(await create(), { status: 201 })
  if (header.length > 200) throw new ApiError(400, 'Idempotency-Key is too long')

  const { runOnce } = await import('../payment-idempotency')
  const result = await runOnce(
    session.tenantId,
    `order:${session.userId}:${header}`,
    201,
    create,
    'This order is already being placed — check your orders before trying again',
  )
  return Response.json(result.body, { status: result.status })
}

