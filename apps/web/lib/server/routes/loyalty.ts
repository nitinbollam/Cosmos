import * as loyalty from '../loyalty'
import { isPortalBuyer, requirePortalCustomerId } from '../buyer-context'
import { ApiError, requirePermission, requireSession } from './common'

export async function routeLoyalty(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const buyerId = isPortalBuyer(session.role) ? await requirePortalCustomerId(session) : undefined

  if (seg.length === 2 && seg[1] === 'me' && method === 'GET') {
    const customerId = buyerId ?? new URL(req.url).searchParams.get('customerId') ?? ''
    if (!customerId) throw new ApiError(400, 'customerId required')
    if (buyerId && buyerId !== customerId) throw new ApiError(403, 'Forbidden')
    if (!buyerId) await requirePermission(req, 'crm.read')
    return Response.json(await loyalty.getLoyaltyAccount(session.tenantId, customerId))
  }

  if (seg.length === 3 && seg[1] === 'me' && seg[2] === 'redeem' && method === 'POST') {
    if (!buyerId) throw new ApiError(403, 'Customer login required')
    const body = (await req.json()) as { points?: number }
    if (body.points == null || body.points <= 0) throw new ApiError(400, 'points required')
    return Response.json(await loyalty.redeemPoints(session.tenantId, buyerId, body.points))
  }

  if (seg.length === 2 && seg[1] === 'adjust' && method === 'POST') {
    await requirePermission(req, 'loyalty.write')
    const body = (await req.json()) as { customerId?: string; pointsDelta?: number; reason?: string }
    if (!body.customerId || body.pointsDelta == null || !body.reason?.trim()) {
      throw new ApiError(400, 'customerId, pointsDelta, and reason required')
    }
    return Response.json(
      await loyalty.adjustLoyaltyPoints(
        session.tenantId,
        body.customerId,
        body.pointsDelta,
        body.reason,
        session.userId,
      ),
    )
  }

  throw new ApiError(404, 'Loyalty route not found')
}
