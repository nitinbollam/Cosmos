import type { DiscountScope, DiscountType } from '@/generated/prisma-tenant'
import * as discounts from '../discounts'
import { ApiError, requirePermission, requireSession, assertNotBuyer } from './common'

export async function routeDiscounts(method: string, seg: string[], req: Request): Promise<Response> {
  const url = new URL(req.url)

  if (seg.length === 2 && seg[1] === 'validate' && method === 'POST') {
    const session = await requireSession(req)
    const body = (await req.json()) as {
      code?: string
      orderSubtotal?: number
      customerId?: string
    }
    if (!body.code?.trim()) throw new ApiError(400, 'code required')
    if (body.orderSubtotal == null || body.orderSubtotal < 0) {
      throw new ApiError(400, 'orderSubtotal required')
    }
    return Response.json(
      await discounts.validateDiscount(session.tenantId, body.code, {
        orderSubtotal: body.orderSubtotal,
        customerId: body.customerId,
        requestedBy: session.userId,
      }),
    )
  }

  if (seg.length === 1 && method === 'GET') {
    const session = await requirePermission(req, 'discounts.read')
    assertNotBuyer(session)
    return Response.json(await discounts.listDiscounts(session.tenantId))
  }

  if (seg.length === 1 && method === 'POST') {
    const session = await requirePermission(req, 'discounts.write')
    assertNotBuyer(session)
    const body = (await req.json()) as {
      code?: string | null
      type?: DiscountType
      scope?: DiscountScope
      amount?: number
      minPurchase?: number | null
      startsAt?: string | null
      expiresAt?: string | null
      usageLimit?: number | null
      perCustomerLimit?: number | null
    }
    if (!body.type || !body.scope || body.amount == null) {
      throw new ApiError(400, 'type, scope, and amount are required')
    }
    return Response.json(
      await discounts.createDiscount(session.tenantId, {
        code: body.code,
        type: body.type,
        scope: body.scope,
        amount: body.amount,
        minPurchase: body.minPurchase,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        usageLimit: body.usageLimit,
        perCustomerLimit: body.perCustomerLimit,
      }),
      { status: 201 },
    )
  }

  if (seg.length === 3 && seg[2] === 'deactivate' && method === 'POST') {
    const session = await requirePermission(req, 'discounts.write')
    assertNotBuyer(session)
    return Response.json(await discounts.deactivateDiscount(session.tenantId, seg[1]))
  }

  throw new ApiError(404, 'Discount route not found')
}
