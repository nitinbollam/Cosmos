import * as giftCards from '../gift-cards'
import { rateLimit, clientIp } from '../auth-security'
import { isPortalBuyer, requirePortalCustomerId } from '../buyer-context'
import { ApiError, requirePermission, requireSession } from './common'

export async function routeGiftCards(method: string, seg: string[], req: Request): Promise<Response> {
  if (seg.length === 1 && method === 'GET') {
    const session = await requirePermission(req, 'gift-cards.read')
    return Response.json(await giftCards.listGiftCards(session.tenantId))
  }

  if (seg.length === 2 && seg[1] === 'purchase' && method === 'POST') {
    const session = await requireSession(req)
    if (!isPortalBuyer(session.role)) throw new ApiError(403, 'Customer login required')
    const customerId = await requirePortalCustomerId(session)
    const body = (await req.json()) as { amount?: number; savedPaymentMethodId?: string }
    if (body.amount == null || body.amount <= 0) throw new ApiError(400, 'amount required')
    if (!body.savedPaymentMethodId?.trim()) {
      throw new ApiError(400, 'Saved payment method required to purchase gift card')
    }

    const { paymentDb } = await import('../db')
    const saved = await paymentDb.savedPaymentMethod.findFirst({
      where: { id: body.savedPaymentMethodId.trim(), tenantId: session.tenantId, customerId },
    })
    if (!saved) throw new ApiError(400, 'Saved payment method not found')

    const { requireStripeConnectContext } = await import('../tenant-stripe-connect')
    const connectCtx = await requireStripeConnectContext(session.tenantId).catch(() => null)
    if (connectCtx && saved.stripePaymentMethodId.startsWith('pm_') && !saved.stripePaymentMethodId.startsWith('pm_demo_')) {
      const { resolveStripeCustomerId } = await import('../stripe-customer-sync')
      const stripeCustomerId = await resolveStripeCustomerId(session.tenantId, customerId)
      const { chargePaymentMethod } = await import('../stripe')
      const chargeRes = await chargePaymentMethod(
        connectCtx,
        body.amount,
        'usd',
        stripeCustomerId,
        saved.stripePaymentMethodId,
      )
      if (!chargeRes.success) {
        throw new ApiError(400, chargeRes.error || 'Payment failed')
      }
    }

    const card = await giftCards.issueGiftCard(session.tenantId, {
      amount: body.amount,
      issuedToCustomerId: customerId,
    })
    const { notifyGiftCardIssued } = await import('../notification-triggers')
    void notifyGiftCardIssued(session.tenantId, card.id, card.code, body.amount, customerId).catch(() => undefined)
    return Response.json(card, { status: 201 })
  }

  if (seg.length === 1 && method === 'POST') {
    const session = await requirePermission(req, 'gift-cards.write')
    const body = (await req.json()) as {
      amount?: number
      issuedToCustomerId?: string
      expiresAt?: string
    }
    if (body.amount == null || body.amount <= 0) throw new ApiError(400, 'amount required')
    const card = await giftCards.issueGiftCard(session.tenantId, {
      amount: body.amount,
      issuedToCustomerId: body.issuedToCustomerId,
      expiresAt: body.expiresAt,
    })
    const { notifyGiftCardIssued } = await import('../notification-triggers')
    void notifyGiftCardIssued(session.tenantId, card.id, card.code, body.amount, body.issuedToCustomerId).catch(
      () => undefined,
    )
    return Response.json(card, { status: 201 })
  }

  if (seg.length === 3 && seg[2] === 'balance' && method === 'GET') {
    rateLimit(`gift-card-balance:${clientIp(req)}`, 30, 60_000)
    const session = await requireSession(req)
    return Response.json(await giftCards.checkGiftCardBalance(session.tenantId, seg[1]))
  }

  if (seg.length === 3 && seg[2] === 'redeem' && method === 'POST') {
    const session = await requireSession(req)
    const body = (await req.json()) as { amount?: number; orderRef?: string }
    if (body.amount == null || body.amount <= 0) throw new ApiError(400, 'amount required')
    if (!body.orderRef?.trim()) throw new ApiError(400, 'orderRef required')
    return Response.json(
      await giftCards.redeemGiftCard(session.tenantId, seg[1], {
        amount: body.amount,
        orderRef: body.orderRef.trim(),
      }),
    )
  }

  if (seg.length === 2 && method === 'GET') {
    const session = await requirePermission(req, 'gift-cards.read')
    return Response.json(await giftCards.getGiftCardDetail(session.tenantId, seg[1]))
  }

  throw new ApiError(404, 'Gift card route not found')
}
