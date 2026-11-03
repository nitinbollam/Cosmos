import * as requisitions from '../purchase-requisitions'
import { convertRequisition } from '../requisition-conversion'
import { ApiError, assertNotBuyer, assertPermission, requireSession } from './common'

async function jsonBody(req: Request): Promise<unknown> {
  const text = await req.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError(400, 'Request body must be JSON')
  }
}

/**
 * /purchase-requisitions. The tenant and the acting user always come from the session; a tenantId or requestedBy in
 * the body is ignored. Approve / reject go through /approvals/:id/decide like every other approval.
 */
export async function routePurchaseRequisitions(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  assertNotBuyer(session)
  // Converting creates a PO, so it needs purchasing.write (not requisitions.write).
  const converting = seg.length === 3 && seg[2] === 'convert' && method === 'POST'
  assertPermission(session, converting ? 'purchasing.write' : method === 'GET' ? 'requisitions.read' : 'requisitions.write')
  const actor = { userId: session.userId, tenantId: session.tenantId, role: session.role }
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(
      await requisitions.listRequisitions(actor, {
        status: url.searchParams.get('status') ?? undefined,
        mine: url.searchParams.get('mine') === '1',
      }),
    )
  }
  if (seg.length === 1 && method === 'POST') {
    return Response.json(await requisitions.createRequisition(actor, await jsonBody(req)), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await requisitions.getRequisition(actor, seg[1]))
  }
  if (seg.length === 2 && method === 'PATCH') {
    return Response.json(await requisitions.updateRequisition(actor, seg[1], await jsonBody(req)))
  }
  if (seg.length === 3 && method === 'POST') {
    if (seg[2] === 'submit') return Response.json(await requisitions.submitRequisition(actor, seg[1]))
    if (seg[2] === 'withdraw') return Response.json(await requisitions.withdrawRequisition(actor, seg[1]))
    if (seg[2] === 'convert') {
      // Body: { number?: string } only. 201 when this call created the PO, 200 when it returned the existing one.
      const { purchaseOrder, created } = await convertRequisition(actor, seg[1], await jsonBody(req))
      return Response.json(purchaseOrder, { status: created ? 201 : 200 })
    }
    if (seg[2] === 'cancel') {
      const body = (await jsonBody(req)) as { reason?: unknown }
      return Response.json(await requisitions.cancelRequisition(actor, seg[1], body?.reason))
    }
  }

  throw new ApiError(404, 'Purchase requisition route not found')
}
