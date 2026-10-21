import * as manufacturing from '../manufacturing'
import { ApiError, requireSession, hasPermission, assertNotBuyer } from './common'

export async function routeManufacturing(
  method: string,
  seg: string[],
  req: Request,
): Promise<Response> {
  const session = await requireSession(req)
  assertNotBuyer(session)
  const url = new URL(req.url)

  const canRead =
    hasPermission(session, 'manufacturing.read') ||
    hasPermission(session, 'inventory.read')
  const canWrite =
    hasPermission(session, 'manufacturing.write') ||
    hasPermission(session, 'inventory.write')

  if (method === 'GET' && !canRead) {
    throw new ApiError(403, 'Forbidden: insufficient manufacturing read permissions')
  }
  if (method !== 'GET' && !canWrite) {
    throw new ApiError(403, 'Forbidden: insufficient manufacturing write permissions')
  }

  // ---------------------------------------------------------------------------
  // /manufacturing/boms
  // ---------------------------------------------------------------------------
  if (seg[1] === 'boms') {
    if (seg.length === 2 && method === 'GET') {
      const skuId = url.searchParams.get('skuId') ?? undefined
      const status = url.searchParams.get('status') ?? undefined
      const search = url.searchParams.get('q') ?? url.searchParams.get('search') ?? undefined
      return Response.json(await manufacturing.listBoms(session.tenantId, { skuId, status, search }))
    }

    if (seg.length === 2 && method === 'POST') {
      const body = (await req.json()) as manufacturing.CreateBomInput
      const created = await manufacturing.createBom(session.tenantId, body, session.userId)
      return Response.json(created, { status: 201 })
    }

    if (seg.length === 3 && method === 'GET') {
      return Response.json(await manufacturing.getBomById(session.tenantId, seg[2]))
    }

    if (seg.length === 3 && (method === 'PATCH' || method === 'PUT')) {
      const body = (await req.json()) as manufacturing.UpdateBomInput
      return Response.json(await manufacturing.updateBom(session.tenantId, seg[2], body, session.userId))
    }

    if (seg.length === 3 && method === 'DELETE') {
      return Response.json(await manufacturing.deleteBom(session.tenantId, seg[2]))
    }
  }

  // ---------------------------------------------------------------------------
  // /manufacturing/orders
  // ---------------------------------------------------------------------------
  if (seg[1] === 'orders') {
    if (seg.length === 2 && method === 'GET') {
      const status = url.searchParams.get('status') ?? undefined
      const warehouseId = url.searchParams.get('warehouseId') ?? undefined
      const skuId = url.searchParams.get('skuId') ?? undefined
      return Response.json(
        await manufacturing.listAssemblyOrders(session.tenantId, { status, warehouseId, skuId }),
      )
    }

    if (seg.length === 2 && method === 'POST') {
      const body = (await req.json()) as manufacturing.CreateAssemblyOrderInput
      const created = await manufacturing.createAssemblyOrder(session.tenantId, body, session.userId)
      return Response.json(created, { status: 201 })
    }

    if (seg.length === 3 && method === 'GET') {
      return Response.json(await manufacturing.getAssemblyOrder(session.tenantId, seg[2]))
    }

    if (seg.length === 4 && seg[3] === 'release' && method === 'POST') {
      return Response.json(await manufacturing.releaseAssemblyOrder(session.tenantId, seg[2], session.userId))
    }

    if (seg.length === 4 && seg[3] === 'complete' && method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as manufacturing.CompleteAssemblyOrderInput
      return Response.json(
        await manufacturing.completeAssemblyOrder(session.tenantId, seg[2], body, session.userId),
      )
    }

    if (seg.length === 4 && seg[3] === 'cancel' && method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { reason?: string }
      return Response.json(
        await manufacturing.cancelAssemblyOrder(session.tenantId, seg[2], body.reason, session.userId),
      )
    }
  }

  // ---------------------------------------------------------------------------
  // /manufacturing/disassemble
  // ---------------------------------------------------------------------------
  if (seg[1] === 'disassemble' && method === 'POST') {
    const body = (await req.json()) as manufacturing.DisassembleKitInput
    return Response.json(await manufacturing.disassembleKit(session.tenantId, body, session.userId))
  }

  throw new ApiError(404, `Unknown manufacturing endpoint: ${method} /${seg.join('/')}`)
}
