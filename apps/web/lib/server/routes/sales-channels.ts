import { SalesChannelSyncStatus } from '@/generated/prisma-sales-channels'
import { ApiError, requireSession, assertPermission } from './common'
import * as core from '../sales-channels/core'
import * as shopify from '../sales-channels/shopify'

function appBaseUrl(): string {
  return (
    process.env.APP_URL?.trim() ||
    process.env.PLEROS_CLIENT_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_WEB_ADMIN_ORIGIN?.trim() ||
    'http://localhost:4000'
  ).replace(/\/$/, '')
}

export async function routeSalesChannels(method: string, seg: string[], req: Request): Promise<Response> {
  if (seg[1] === 'shopify' && seg[2] === 'callback' && method === 'GET') {
    const url = new URL(req.url)
    const shop = url.searchParams.get('shop') ?? ''
    const code = url.searchParams.get('code') ?? ''
    const state = url.searchParams.get('state') ?? ''
    if (!shop || !code || !state) throw new ApiError(400, 'Missing Shopify OAuth parameters')
    await shopify.handleShopifyOAuthCallback({ shop, code, state })
    return Response.redirect(`${appBaseUrl()}/admin/settings?tab=integrations&shopify=connected`, 302)
  }

  const session = await requireSession(req)

  if (seg[1] === 'shopify' && seg[2] === 'connect' && method === 'GET') {
    assertPermission(session, 'settings.write')
    const url = new URL(req.url)
    const shop = url.searchParams.get('shop')?.trim()
    if (!shop) throw new ApiError(400, 'shop query parameter is required')
    const authorizeUrl = shopify.getShopifyAuthorizeUrl(shop, session.tenantId)
    return Response.redirect(authorizeUrl, 302)
  }

  if (seg.length === 1 && method === 'GET') {
    assertPermission(session, 'settings.read')
    return Response.json(await core.listConnections(session.tenantId))
  }

  if (seg.length === 2 && method === 'DELETE') {
    assertPermission(session, 'settings.write')
    await core.disconnectChannel(session.tenantId, seg[1]!)
    return new Response(null, { status: 204 })
  }

  if (seg.length === 3 && seg[2] === 'listings' && method === 'GET') {
    assertPermission(session, 'settings.read')
    const url = new URL(req.url)
    const syncStatus = url.searchParams.get('syncStatus') as SalesChannelSyncStatus | null
    return Response.json(
      await core.listConnectionListings(session.tenantId, seg[1]!, {
        syncStatus: syncStatus ?? undefined,
      }),
    )
  }

  if (seg.length === 3 && seg[2] === 'sync-all' && method === 'POST') {
    assertPermission(session, 'settings.write')
    const queued = await core.queueAllEligibleSkus(session.tenantId, seg[1]!)
    return Response.json({ queued })
  }

  if (seg.length === 3 && seg[2] === 'flush' && method === 'POST') {
    assertPermission(session, 'settings.write')
    return Response.json(await core.flushPendingPushes(seg[1]!))
  }

  if (seg.length === 5 && seg[2] === 'listings' && seg[4] === 'retry' && method === 'POST') {
    assertPermission(session, 'settings.write')
    const listing = await core.retryListing(session.tenantId, seg[3]!)
    return Response.json(listing)
  }

  throw new ApiError(404, 'Sales channel route not found')
}
