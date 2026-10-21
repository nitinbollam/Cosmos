import { ApiError, requirePermission } from './common'
import * as vans from '../van-stock'

export async function routeVans(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requirePermission(req, method === 'GET' ? 'dispatch.read' : 'inventory.write')
  const actor = { userId: session.userId, role: session.role }
  const isDriver = session.role.toUpperCase() === 'DRIVER'

  if (seg.length === 1 && method === 'GET') return Response.json(await vans.listVans(session.tenantId, actor))
  if (seg.length === 2 && seg[1] !== 'customers' && method === 'GET') {
    return Response.json(await vans.getVanInventory(session.tenantId, seg[1], actor))
  }
  // Everything below is for managers and warehouse staff, not the driver on the road.
  if (isDriver) throw new ApiError(403, 'Drivers cannot create vans or change who can buy from them')
  if (seg.length === 1 && method === 'POST') {
    return Response.json(await vans.createVan(session.tenantId, (await req.json()) as never), { status: 201 })
  }
  if (seg.length === 3 && seg[2] === 'load' && method === 'POST') {
    return Response.json(await vans.loadVan(session.tenantId, seg[1], (await req.json()) as never, actor))
  }
  if (seg.length === 3 && seg[2] === 'unload' && method === 'POST') {
    return Response.json(await vans.unloadVan(session.tenantId, seg[1], (await req.json()) as never, actor))
  }
  if (seg.length === 4 && seg[1] === 'customers' && seg[3] === 'van-sales' && method === 'PUT') {
    const body = (await req.json()) as { approved?: unknown }
    if (typeof body.approved !== 'boolean') throw new ApiError(400, 'approved must be true or false')
    return Response.json(await vans.setVanSalesApproved(session.tenantId, seg[2], body.approved))
  }
  throw new ApiError(404, 'Van route not found')
}
