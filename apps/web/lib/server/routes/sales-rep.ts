import { ApiError, requirePermission } from './common'
import * as rep from '../sales-rep'

/** Field sales: `/rep/...`. A rep sees their own accounts and leads; managers see all. */
export async function routeSalesRep(method: string, seg: string[], req: Request): Promise<Response> {
  const read = method === 'GET'
  const url = new URL(req.url)
  const sub = seg[1]
  // Quotes and orders need their own permission on top of CRM access.
  const needs =
    sub === 'accounts' && seg[3] === 'quote' ? 'quotes.write'
      : sub === 'accounts' && seg[3] === 'orders' ? 'orders.write'
        : read ? 'crm.read' : 'crm.write'
  const session = await requirePermission(req, needs)
  const viewer = { userId: session.userId, role: session.role }
  const t = session.tenantId
  const body = async () => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>

  if (sub === 'accounts') {
    if (seg.length === 2 && read) {
      return Response.json(await rep.listAccounts(t, viewer, { scope: url.searchParams.get('scope') ?? undefined, q: url.searchParams.get('q') ?? undefined }))
    }
    if (seg.length === 3 && read) return Response.json(await rep.accountDetail(t, viewer, seg[2]))
    if (seg.length === 4 && seg[3] === 'catalog' && read) {
      return Response.json(await rep.catalogForAccount(t, viewer, seg[2], url.searchParams.get('q') ?? undefined))
    }
    if (seg.length === 4 && seg[3] === 'quote' && method === 'POST') {
      return Response.json(await rep.quoteForAccount(t, viewer, seg[2], await body()), { status: 201 })
    }
    if (seg.length === 4 && seg[3] === 'orders' && method === 'POST') {
      return Response.json(await rep.orderForAccount(t, viewer, seg[2], await body()), { status: 201 })
    }
    if (seg.length === 4 && seg[3] === 'credit-request' && method === 'POST') {
      return Response.json(await rep.requestCreditIncrease(t, viewer, seg[2], await body()), { status: 201 })
    }
  }
  if (sub === 'credit-requests' && seg.length === 2 && read) return Response.json(await rep.listCreditRequests(t, viewer))
  if (sub === 'leads') {
    if (seg.length === 2 && read) return Response.json(await rep.listRepLeads(t, viewer))
    if (seg.length === 2 && method === 'POST') return Response.json(await rep.createRepLead(t, viewer, await body()), { status: 201 })
    if (seg.length === 3 && method === 'PATCH') return Response.json(await rep.setLeadStatus(t, viewer, seg[2], (await body()).status))
    if (seg.length === 4 && seg[3] === 'claim' && method === 'POST') return Response.json(await rep.claimLead(t, viewer, seg[2]))
    if (seg.length === 4 && seg[3] === 'convert' && method === 'POST') {
      const name = (await body()).name
      return Response.json(await rep.convertRepLead(t, viewer, seg[2], typeof name === 'string' ? name : undefined))
    }
  }
  throw new ApiError(404, 'Rep route not found')
}
