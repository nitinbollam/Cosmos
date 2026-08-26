import * as orders from '../orders'
import * as dispatch from '../dispatch'
import * as purchasing from '../purchasing'
import * as edi from '../edi'
import { ApiError, requireSession, requirePermission, assertPermission, assertNotBuyer } from './common'

export async function routeRoutes(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'dispatch.read' : 'dispatch.write')
  const url = new URL(req.url)

  if (seg.length === 2 && seg[1] === 'shipped-orders' && method === 'GET') {
    return Response.json(await orders.listShippedOrdersForDispatch(session.tenantId))
  }
  if (seg.length === 2 && seg[1] === 'from-orders' && method === 'POST') {
    const body = (await req.json()) as { orderIds?: string[]; name?: string; scheduledFor?: string }
    if (!body.orderIds?.length) throw new ApiError(400, 'orderIds required')
    return Response.json(
      await dispatch.createRouteFromOrders(session.tenantId, {
        orderIds: body.orderIds,
        name: body.name,
        scheduledFor: body.scheduledFor,
      }),
      { status: 201 },
    )
  }
  if (seg.length === 1 && method === 'GET') {
    return Response.json(await dispatch.listRoutes(session.tenantId, url.searchParams.get('date') ?? undefined))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof dispatch.createRoute>[1]
    return Response.json(await dispatch.createRoute(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await dispatch.getRoute(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'driver' && method === 'PATCH') {
    const body = (await req.json()) as { driverId?: string }
    if (!body.driverId) throw new ApiError(400, 'driverId required')
    return Response.json(await dispatch.assignRouteDriver(session.tenantId, seg[1], body.driverId))
  }
  if (seg.length === 4 && seg[2] === 'stops' && seg[3] === 'reorder' && method === 'PATCH') {
    const body = (await req.json()) as { stopIds?: string[] }
    if (!body.stopIds?.length) throw new ApiError(400, 'stopIds required')
    return Response.json(await dispatch.reorderRouteStops(session.tenantId, seg[1], body.stopIds))
  }
  if (
    ((seg.length === 3 && seg[2] === 'optimize') || (seg.length === 4 && seg[2] === 'stops' && seg[3] === 'optimize')) &&
    (method === 'POST' || method === 'PATCH')
  ) {
    return Response.json(await dispatch.optimizeRouteStopsNearestNeighbor(session.tenantId, seg[1]))
  }
  if (seg.length === 5 && seg[2] === 'stops' && seg[4] === 'delivered' && method === 'POST') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(
      await dispatch.markStopDelivered(session.tenantId, seg[1], seg[3], body, { userId: session.userId }),
    )
  }
  if (seg.length === 5 && seg[2] === 'stops' && seg[4] === 'failed' && method === 'POST') {
    const body = (await req.json()) as { reason?: string }
    return Response.json(await dispatch.markStopFailed(session.tenantId, seg[1], seg[3], body.reason))
  }
  throw new ApiError(404, 'Route route not found')
}

export async function routeDispatchMobile(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requirePermission(req, 'dispatch.write')

  if (seg[1] === 'driver' && seg[2] === 'location' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof dispatch.recordDriverLocation>[2]
    return Response.json(await dispatch.recordDriverLocation(session.tenantId, session.userId, body))
  }
  if (seg[1] === 'stops' && seg.length === 4 && seg[3] === 'pod' && method === 'POST') {
    const body = (await req.json()) as Record<string, unknown>
    const routeId = String(body.routeId ?? '')
    if (!routeId.trim()) throw new ApiError(400, 'routeId is required in body')
    const { routeId: _r, stopId: _s, ...pod } = body
    return Response.json(
      await dispatch.markStopDelivered(session.tenantId, routeId, seg[2], pod, { userId: session.userId }),
    )
  }
  throw new ApiError(404, 'Dispatch route not found')
}

export async function routePurchaseOrders(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'purchasing.read' : 'purchasing.write')
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await purchasing.listPurchaseOrders(session.tenantId, url.searchParams.get('status') ?? undefined))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as purchasing.CreatePurchaseOrderInput
    return Response.json(await purchasing.createPurchaseOrder(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await purchasing.getPurchaseOrder(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'submit' && method === 'POST') {
    return Response.json(await purchasing.submitPurchaseOrder(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'cancel' && method === 'POST') {
    return Response.json(await purchasing.cancelPurchaseOrder(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'receive' && method === 'POST') {
    const body = (await req.json()) as purchasing.ReceiveGoodsInput
    return Response.json(await purchasing.receiveGoods(session.tenantId, seg[1], body, session.userId))
  }
  if (seg.length === 3 && seg[2] === 'payments' && method === 'POST') {
    const body = (await req.json()) as purchasing.RecordPoPaymentInput
    return Response.json(await purchasing.recordPurchaseOrderPayment(session.tenantId, seg[1], body))
  }
  if (seg.length === 3 && seg[2] === 'landed-costs' && method === 'GET') {
    return Response.json(await purchasing.getPurchaseOrderLandedCostPreview(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'landed-costs' && method === 'PATCH') {
    const body = (await req.json()) as Parameters<typeof purchasing.updatePurchaseOrderLandedCosts>[2]
    return Response.json(await purchasing.updatePurchaseOrderLandedCosts(session.tenantId, seg[1], body))
  }

  throw new ApiError(404, 'Purchase order route not found')
}

export async function routeSuppliers(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  assertNotBuyer(session)
  assertPermission(session, method === 'GET' ? 'purchasing.read' : 'purchasing.write')

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await purchasing.listSuppliers(session.tenantId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof purchasing.createSupplier>[1]
    return Response.json(await purchasing.createSupplier(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await purchasing.getSupplier(session.tenantId, seg[1]))
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as Parameters<typeof purchasing.updateSupplier>[2]
    return Response.json(await purchasing.updateSupplier(session.tenantId, seg[1], body))
  }

  throw new ApiError(404, 'Supplier route not found')
}

export async function routeEdi(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'edi.read' : 'edi.write')
  const url = new URL(req.url)

  if (seg[1] === 'partners') {
    if (seg.length === 2 && method === 'GET') {
      return Response.json(await edi.listTradingPartners(session.tenantId))
    }
    if (seg.length === 2 && method === 'POST') {
      const body = (await req.json()) as Parameters<typeof edi.createTradingPartner>[1]
      return Response.json(await edi.createTradingPartner(session.tenantId, body), { status: 201 })
    }
    if (seg.length === 3 && method === 'PATCH') {
      const body = (await req.json()) as Parameters<typeof edi.updateTradingPartner>[2]
      return Response.json(await edi.updateTradingPartner(session.tenantId, seg[2], body))
    }
  }

  if (seg[1] === 'documents' && seg.length === 2 && method === 'GET') {
    const limit = +(url.searchParams.get('limit') ?? 50)
    return Response.json(await edi.listEdiDocuments(session.tenantId, limit))
  }

  if (seg[1] === 'inbound' && seg[2] === '850' && method === 'POST') {
    const body = (await req.json()) as edi.Edi850Payload
    return Response.json(await edi.ingest850(session.tenantId, body), { status: 201 })
  }

  if (seg[1] === 'documents' && seg.length === 4 && seg[3] === 'process' && method === 'POST') {
    const orderId = await edi.process850Document(session.tenantId, seg[2])
    return Response.json({ orderId })
  }

  if (seg[1] === 'outbound' && seg[2] === '810' && method === 'POST') {
    const body = (await req.json()) as { invoiceId: string }
    if (!body.invoiceId) throw new ApiError(400, 'invoiceId required')
    return Response.json(await edi.generate810ForInvoice(session.tenantId, body.invoiceId), { status: 201 })
  }

  if (seg[1] === 'outbound' && seg[2] === '856' && method === 'POST') {
    const body = (await req.json()) as { orderId: string; shipmentNo: number }
    if (!body.orderId || body.shipmentNo == null) throw new ApiError(400, 'orderId and shipmentNo required')
    return Response.json(
      await edi.generate856ForShipment(session.tenantId, body.orderId, body.shipmentNo),
      { status: 201 },
    )
  }

  throw new ApiError(404, 'EDI route not found')
}
