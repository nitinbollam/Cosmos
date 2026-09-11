import { tenantDb } from './db'
import * as notifications from './notifications'

async function tenantNotifyEmail(tenantId: string): Promise<string | null> {
  const org = await tenantDb.tenantOrganization.findUnique({
    where: { id: tenantId },
    select: { billingEmail: true },
  })
  return org?.billingEmail?.trim() || null
}

export async function notifyMarketplaceEvent(
  tenantId: string,
  templateKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const email = await tenantNotifyEmail(tenantId)
  if (!email) return
  try {
    await notifications.send(tenantId, {
      channel: 'EMAIL',
      recipient: email,
      templateKey,
      payload,
    })
  } catch (err) {
    console.error('[marketplace-notify]', templateKey, err)
  }
}

export async function notifyAuctionOutbid(bidderTenantId: string, listingTitle: string, newBidCents: number) {
  await notifyMarketplaceEvent(bidderTenantId, 'marketplace.auction.outbid', {
    listingTitle,
    newBid: (newBidCents / 100).toFixed(2),
  })
}

export async function notifyAuctionWon(buyerTenantId: string, listingTitle: string, amountCents: number) {
  await notifyMarketplaceEvent(buyerTenantId, 'marketplace.auction.won', {
    listingTitle,
    amount: (amountCents / 100).toFixed(2),
  })
}

export async function notifyPaymentDue(buyerTenantId: string, orderId: string, amountCents: number) {
  await notifyMarketplaceEvent(buyerTenantId, 'marketplace.payment.due', {
    orderId: orderId.slice(-8),
    amount: (amountCents / 100).toFixed(2),
  })
}

export async function notifySavedSearchMatch(tenantId: string, listingTitle: string, category: string) {
  await notifyMarketplaceEvent(tenantId, 'marketplace.search.match', { listingTitle, category })
}
