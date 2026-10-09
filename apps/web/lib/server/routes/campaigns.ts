import * as campaigns from '../campaigns'
import { verifyUnsubscribeToken, suppressCustomer } from '../campaign-unsubscribe'
import { ApiError, requirePermission } from './common'

export async function routeCampaigns(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requirePermission(req, 'campaigns.read')

  if (seg.length === 2 && seg[1] === 'segments' && method === 'GET') {
    return Response.json(await campaigns.listSegments(session.tenantId))
  }

  if (seg.length === 4 && seg[1] === 'segments' && seg[3] === 'preview' && method === 'GET') {
    return Response.json(await campaigns.previewSegmentCount(session.tenantId, seg[2]!))
  }

  if (seg.length === 2 && seg[1] === 'segments' && method === 'POST') {
    await requirePermission(req, 'campaigns.write')
    const body = (await req.json()) as { name?: string; filterCriteria?: Record<string, unknown> }
    if (!body.name?.trim()) throw new ApiError(400, 'name required')
    return Response.json(
      await campaigns.createSegment(session.tenantId, {
        name: body.name,
        filterCriteria: (body.filterCriteria ?? {}) as import('../campaigns').SegmentFilter,
      }),
      { status: 201 },
    )
  }

  if (seg.length === 4 && seg[1] === 'segments' && seg[3] === 'preview' && method === 'GET') {
    return Response.json(await campaigns.previewSegmentCount(session.tenantId, seg[2]!))
  }

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await campaigns.listCampaigns(session.tenantId))
  }

  if (seg.length === 1 && method === 'POST') {
    await requirePermission(req, 'campaigns.write')
    const body = (await req.json()) as {
      name?: string
      segmentId?: string
      subject?: string
      body?: string
      scheduledAt?: string | null
    }
    if (!body.name || !body.segmentId || !body.subject || !body.body) {
      throw new ApiError(400, 'name, segmentId, subject, and body required')
    }
    return Response.json(
      await campaigns.createCampaign(session.tenantId, {
        name: body.name,
        segmentId: body.segmentId,
        subject: body.subject,
        body: body.body,
        scheduledAt: body.scheduledAt,
      }),
      { status: 201 },
    )
  }

  if (seg.length === 3 && seg[2] === 'send' && method === 'POST') {
    await requirePermission(req, 'campaigns.write')
    return Response.json(await campaigns.sendCampaign(session.tenantId, seg[1]!))
  }

  throw new ApiError(404, 'Campaign route not found')
}

export async function routeUnsubscribe(method: string, seg: string[], req: Request): Promise<Response> {
  if (seg.length === 1 && (method === 'GET' || method === 'POST')) {
    const token = new URL(req.url).searchParams.get('token') ?? ''
    const parsed = verifyUnsubscribeToken(token)
    const isJson = req.headers.get('accept')?.includes('application/json')
    if (!parsed) {
      if (isJson) return Response.json({ valid: false, error: 'Invalid or expired link' }, { status: 400 })
      return new Response('<html><body><h1>Invalid or expired link</h1></body></html>', {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
    await suppressCustomer(parsed.tenantId, parsed.customerId)
    if (isJson) return Response.json({ valid: true, message: 'You have been unsubscribed' })
    return new Response(
      '<html><body><h1>You have been unsubscribed</h1><p>You will no longer receive marketing emails from this distributor.</p></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
  throw new ApiError(404, 'Unsubscribe route not found')
}
