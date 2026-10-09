import type { SubscriptionInterval } from '@/generated/prisma-tenant'
import * as subscriptions from '../subscriptions'
import { isPortalBuyer, requirePortalCustomerId } from '../buyer-context'
import { ApiError, requirePermission, requireSession, assertRole, ADMIN_ROLES } from './common'

export async function routeSubscriptions(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const buyerId = isPortalBuyer(session.role) ? await requirePortalCustomerId(session) : undefined

  if (seg.length === 1 && method === 'GET') {
    if (buyerId) {
      return Response.json(await subscriptions.listSubscriptions(session.tenantId, buyerId))
    }
    await requirePermission(req, 'subscriptions.read')
    return Response.json(await subscriptions.listSubscriptions(session.tenantId))
  }

  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as subscriptions.CreateSubscriptionInput
    const customerId = buyerId ?? body.customerId
    if (!customerId) throw new ApiError(400, 'customerId required')
    if (buyerId && buyerId !== customerId) throw new ApiError(403, 'Forbidden')
    if (!buyerId) await requirePermission(req, 'subscriptions.write')
    return Response.json(
      await subscriptions.createSubscription(session.tenantId, { ...body, customerId }),
      { status: 201 },
    )
  }

  if (seg.length === 2 && method === 'GET') {
    return Response.json(await subscriptions.getSubscription(session.tenantId, seg[1], buyerId))
  }

  const actionHandlers: Record<string, () => Promise<Response>> = {
    pause: async () =>
      Response.json(await subscriptions.pauseSubscription(session.tenantId, seg[1], buyerId)),
    resume: async () =>
      Response.json(await subscriptions.resumeSubscription(session.tenantId, seg[1], buyerId)),
    cancel: async () =>
      Response.json(await subscriptions.cancelSubscription(session.tenantId, seg[1], buyerId)),
    retry: async () => {
      if (buyerId) throw new ApiError(403, 'Admin only')
      await requirePermission(req, 'subscriptions.write')
      return Response.json(await subscriptions.retrySubscription(session.tenantId, seg[1]))
    },
    lines: async () => {
      const body = (await req.json()) as {
        lines?: Array<{ skuId: string; warehouseId: string; quantity: number }>
      }
      if (!body.lines?.length) throw new ApiError(400, 'lines required')
      return Response.json(
        await subscriptions.updateSubscriptionLines(session.tenantId, seg[1], body.lines, buyerId),
      )
    },
  }

  if (seg.length === 3 && method === 'POST') {
    const handler = actionHandlers[seg[2]!]
    if (handler) return handler()
  }

  throw new ApiError(404, 'Subscription route not found')
}

export async function routeSubscriptionJobs(method: string, seg: string[], req: Request): Promise<Response> {
  if (seg.length === 3 && seg[2] === 'process-due' && method === 'POST') {
    await assertRole(await requireSession(req), ADMIN_ROLES)
    return Response.json(await subscriptions.processDueSubscriptions())
  }
  throw new ApiError(404, 'Subscription job route not found')
}
