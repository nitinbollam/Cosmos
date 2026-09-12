import * as auctions from '../marketplace-auctions'
import * as buyerPayments from '../marketplace-buyer-payments'
import * as listings from '../marketplace-listings'
import * as messages from '../marketplace-messages'
import * as orders from '../marketplace-orders'
import * as ratings from '../marketplace-ratings'
import * as savedSearches from '../marketplace-saved-searches'
import { getSellerAnalytics } from '../marketplace-analytics'
import { persistMarketplacePhoto, readMarketplaceUpload } from '../marketplace-upload'
import { MARKETPLACE_ALLOWED_CATEGORIES } from '../marketplace-constants'
import { getOrCreateMarketplaceProfile, toPublicProfile } from '../marketplace-profiles'
import { assertFeature } from '../feature-flags'
import { ApiError, requirePermission } from './common'

async function requireMarketplaceEnabled(tenantId: string) {
  await assertFeature(tenantId, 'marketplace')
}

export async function routeMarketplace(method: string, seg: string[], req: Request): Promise<Response> {
  if (seg[1] === 'uploads' && seg.length >= 3 && method === 'GET') {
    const relative = seg.slice(2).join('/')
    const file = readMarketplaceUpload(relative)
    if (!file) throw new ApiError(404, 'Upload not found')
    return new Response(file.buf, { headers: { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=86400' } })
  }

  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'marketplace.read' : 'marketplace.write')
  const url = new URL(req.url)

  if (seg[1] === 'uploads' && seg.length === 2 && method === 'POST') {
    await requireMarketplaceEnabled(session.tenantId)
    const body = (await req.json()) as { fileName: string; contentBase64: string; mimeType?: string }
    const urlPath = await persistMarketplacePhoto(session.tenantId, body)
    return Response.json({ url: urlPath }, { status: 201 })
  }

  if (seg[1] === 'profile') {
    if (seg.length === 2 && method === 'GET') {
      await requireMarketplaceEnabled(session.tenantId)
      const profile = await getOrCreateMarketplaceProfile(session.tenantId)
      return Response.json(toPublicProfile(profile))
    }
    if (seg.length === 2 && method === 'POST') {
      await requireMarketplaceEnabled(session.tenantId)
      const profile = await getOrCreateMarketplaceProfile(session.tenantId)
      return Response.json(toPublicProfile(profile), { status: 201 })
    }
  }

  if (seg[1] === 'payment-methods') {
    if (seg.length === 2 && method === 'GET') {
      await requireMarketplaceEnabled(session.tenantId)
      return Response.json(await buyerPayments.listMarketplacePaymentMethods(session.tenantId))
    }
    if (seg.length === 2 && method === 'POST') {
      await requireMarketplaceEnabled(session.tenantId)
      const body = (await req.json()) as Parameters<typeof buyerPayments.saveMarketplacePaymentMethod>[1]
      return Response.json(await buyerPayments.saveMarketplacePaymentMethod(session.tenantId, body), { status: 201 })
    }
    if (seg.length === 3 && method === 'DELETE') {
      await requireMarketplaceEnabled(session.tenantId)
      return Response.json(await buyerPayments.deleteMarketplacePaymentMethod(session.tenantId, seg[2]))
    }
  }

  if (seg[1] === 'saved-searches') {
    if (seg.length === 2 && method === 'GET') {
      await requireMarketplaceEnabled(session.tenantId)
      return Response.json(await savedSearches.listSavedSearches(session.tenantId))
    }
    if (seg.length === 2 && method === 'POST') {
      await requireMarketplaceEnabled(session.tenantId)
      const body = (await req.json()) as Parameters<typeof savedSearches.createSavedSearch>[1]
      return Response.json(await savedSearches.createSavedSearch(session.tenantId, body), { status: 201 })
    }
    if (seg.length === 3 && method === 'DELETE') {
      await requireMarketplaceEnabled(session.tenantId)
      return Response.json(await savedSearches.deleteSavedSearch(session.tenantId, seg[2]))
    }
  }

  if (seg[1] === 'analytics' && seg[2] === 'seller' && method === 'GET') {
    await requireMarketplaceEnabled(session.tenantId)
    const days = Number(url.searchParams.get('days') ?? '30')
    return Response.json(await getSellerAnalytics(session.tenantId, days))
  }

  if (seg[1] === 'categories' && method === 'GET') {
    await requireMarketplaceEnabled(session.tenantId)
    return Response.json(MARKETPLACE_ALLOWED_CATEGORIES)
  }

  if (seg[1] === 'listings') {
    if (seg.length === 2 && method === 'GET') {
      await requireMarketplaceEnabled(session.tenantId)
      const category = url.searchParams.get('category') ?? undefined
      const search = url.searchParams.get('search') ?? undefined
      const mine = url.searchParams.get('mine') === 'true'
      if (mine) {
        return Response.json(await listings.listSellerListings(session.tenantId))
      }
      return Response.json(await listings.listLiveListings({ category, search }))
    }
    if (seg.length === 2 && method === 'POST') {
      await requireMarketplaceEnabled(session.tenantId)
      const body = (await req.json()) as Parameters<typeof listings.createListing>[2]
      return Response.json(await listings.createListing(session.tenantId, session.userId, body), {
        status: 201,
      })
    }
    if (seg.length === 3 && method === 'GET') {
      await requireMarketplaceEnabled(session.tenantId)
      return Response.json(await listings.getPublicListing(seg[2]))
    }
    if (seg.length === 3 && method === 'DELETE') {
      await requireMarketplaceEnabled(session.tenantId)
      return Response.json(await listings.removeListing(session.tenantId, seg[2]))
    }
  }

  if (seg[1] === 'auctions') {
    if (seg.length === 3 && method === 'GET') {
      await requireMarketplaceEnabled(session.tenantId)
      return Response.json(await auctions.getAuctionDetail(seg[2]))
    }
    if (seg.length === 4 && seg[3] === 'bids' && method === 'POST') {
      await requireMarketplaceEnabled(session.tenantId)
      const body = (await req.json()) as { amountCents: number }
      if (!body.amountCents || body.amountCents < 1) throw new ApiError(400, 'amountCents required')
      return Response.json(await auctions.placeBid(session.tenantId, seg[2], body.amountCents), { status: 201 })
    }
  }

  if (seg[1] === 'orders') {
    if (seg.length === 2 && method === 'GET') {
      await requireMarketplaceEnabled(session.tenantId)
      const role = url.searchParams.get('role')
      if (role === 'seller') return Response.json(await orders.listSellerOrders(session.tenantId))
      return Response.json(await orders.listBuyerOrders(session.tenantId))
    }
    if (seg.length === 2 && method === 'POST') {
      await requireMarketplaceEnabled(session.tenantId)
      const body = (await req.json()) as { listingId: string; quantity: number }
      if (!body.listingId) throw new ApiError(400, 'listingId required')
      return Response.json(
        await orders.createMarketplaceOrder(session.tenantId, body.listingId, body.quantity ?? 1),
        { status: 201 },
      )
    }
    if (seg.length === 4 && seg[3] === 'messages' && method === 'GET') {
      await requireMarketplaceEnabled(session.tenantId)
      return Response.json(await messages.listOrderMessages(session.tenantId, seg[2]))
    }
    if (seg.length === 4 && seg[3] === 'messages' && method === 'POST') {
      await requireMarketplaceEnabled(session.tenantId)
      const body = (await req.json()) as { body: string }
      return Response.json(await messages.postOrderMessage(session.tenantId, seg[2], body.body ?? ''), {
        status: 201,
      })
    }
    if (seg.length === 4 && seg[3] === 'payment-intent' && method === 'POST') {
      await requireMarketplaceEnabled(session.tenantId)
      return Response.json(await orders.startMarketplacePayment(session.tenantId, seg[2]))
    }
    if (seg.length === 4 && seg[3] === 'pay' && method === 'POST') {
      await requireMarketplaceEnabled(session.tenantId)
      const body = (await req.json()) as { stripePaymentIntentId: string }
      if (!body.stripePaymentIntentId) throw new ApiError(400, 'stripePaymentIntentId required')
      return Response.json(
        await orders.confirmMarketplacePayment(session.tenantId, seg[2], body.stripePaymentIntentId),
      )
    }
    if (seg.length === 4 && seg[3] === 'rate' && method === 'POST') {
      await requireMarketplaceEnabled(session.tenantId)
      const body = (await req.json()) as { stars: number; comment?: string }
      return Response.json(
        await ratings.rateMarketplaceOrder(session.tenantId, seg[2], body.stars, body.comment),
        { status: 201 },
      )
    }
    if (seg.length === 4 && seg[3] === 'dispute' && method === 'POST') {
      await requireMarketplaceEnabled(session.tenantId)
      const body = (await req.json()) as { notes?: string }
      return Response.json(await orders.openMarketplaceDispute(session.tenantId, seg[2], body.notes ?? ''))
    }
  }

  throw new ApiError(404, 'Marketplace route not found')
}
