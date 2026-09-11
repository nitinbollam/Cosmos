import { closeExpiredAuctions } from '../marketplace-auctions'
import { resolveMarketplaceDispute, closeMarketplaceDispute } from '../marketplace-disputes'
import { runMarketplaceJobs } from '../marketplace-jobs'
import { getOpsShipmentDetail } from '../marketplace-shipping'
import * as ops from '../marketplace-ops'
import { releaseDueMarketplaceEscrows } from '../marketplace-orders'
import { ApiError, requireRole } from './common'

const PLEROS_OPS_ROLES = ['SUPER_ADMIN'] as const

/** Pleros internal ops — never tenant ERP. SUPER_ADMIN only. */
export async function routePlerosOps(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireRole(req, PLEROS_OPS_ROLES)
  const url = new URL(req.url)

  if (seg[1] === 'marketplace' && seg[2] === 'listings') {
    if (seg.length === 4 && seg[3] === 'pending' && method === 'GET') {
      return Response.json(await ops.listPendingReviewListings())
    }
    if (seg.length === 5 && seg[4] === 'approve' && method === 'POST') {
      return Response.json(await ops.approveListing(seg[3], session.userId))
    }
    if (seg.length === 5 && seg[4] === 'reject' && method === 'POST') {
      const body = (await req.json()) as { reason?: string }
      return Response.json(await ops.rejectListing(seg[3], session.userId, body.reason ?? ''))
    }
  }

  if (seg[1] === 'marketplace' && seg[2] === 'jobs' && seg[3] === 'run' && method === 'POST') {
    return Response.json(await runMarketplaceJobs())
  }

  if (seg[1] === 'marketplace' && seg[2] === 'auctions' && seg[3] === 'close-expired' && method === 'POST') {
    const closed = await closeExpiredAuctions()
    return Response.json({ closed })
  }

  if (seg[1] === 'marketplace' && seg[2] === 'escrow' && seg[3] === 'release-due' && method === 'POST') {
    const released = await releaseDueMarketplaceEscrows()
    return Response.json({ released })
  }

  if (seg[1] === 'marketplace' && seg[2] === 'orders') {
    if (seg.length === 3 && method === 'GET') {
      const queue = url.searchParams.get('queue') as
        | 'fulfillment'
        | 'delivery'
        | 'escrow'
        | 'disputed'
        | 'all'
        | null
      return Response.json(await ops.listOpsMarketplaceOrders({ queue: queue ?? 'all' }))
    }
    if (seg.length === 5 && seg[4] === 'shipment' && method === 'POST') {
      const body = (await req.json()) as { shipmentRef: string }
      if (!body.shipmentRef?.trim()) throw new ApiError(400, 'shipmentRef required')
      return Response.json(await ops.assignKalafleetShipment(seg[3], body.shipmentRef))
    }
    if (seg.length === 5 && seg[4] === 'deliver' && method === 'POST') {
      return Response.json(await ops.confirmMarketplaceDelivery(seg[3]))
    }
    if (seg.length === 5 && seg[4] === 'release-escrow' && method === 'POST') {
      return Response.json(await ops.releaseMarketplaceEscrow(seg[3]))
    }
    if (seg.length === 5 && seg[4] === 'shipment-detail' && method === 'GET') {
      return Response.json(await getOpsShipmentDetail(seg[3]))
    }
    if (seg.length === 6 && seg[4] === 'dispute' && seg[5] === 'resolve' && method === 'POST') {
      const body = (await req.json()) as {
        resolutionNotes?: string
        refundBuyer?: boolean
        releaseToSeller?: boolean
      }
      return Response.json(
        await resolveMarketplaceDispute(seg[3], {
          resolutionNotes: body.resolutionNotes ?? '',
          refundBuyer: body.refundBuyer,
          releaseToSeller: body.releaseToSeller,
        }),
      )
    }
    if (seg.length === 6 && seg[4] === 'dispute' && seg[5] === 'close' && method === 'POST') {
      const body = (await req.json()) as { resolutionNotes?: string }
      return Response.json(await closeMarketplaceDispute(seg[3], body.resolutionNotes ?? ''))
    }
  }

  throw new ApiError(404, 'Pleros ops route not found')
}
