import { marketplaceDb } from './db'
import { getOrCreateMarketplaceProfile, toPublicProfile } from './marketplace-profiles'
import { redactCounterpartyPayload } from './marketplace-privacy'
import { notifyMarketplaceEvent } from './marketplace-notifications'
import { recordMessageResponseTime } from './marketplace-trust'
import { ApiError } from './session'

export async function listOrderMessages(tenantId: string, orderId: string) {
  const order = await marketplaceDb.marketplaceOrder.findFirst({
    where: {
      id: orderId,
      OR: [{ buyerTenantId: tenantId }, { sellerTenantId: tenantId }],
    },
  })
  if (!order) throw new ApiError(404, 'Order not found')

  const rows = await marketplaceDb.marketplaceMessage.findMany({
    where: { orderId },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })

  return Promise.all(
    rows.map(async (m) => {
      const profile = await getOrCreateMarketplaceProfile(m.senderTenantId)
      return redactCounterpartyPayload({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        sender: toPublicProfile(profile),
        isMine: m.senderTenantId === tenantId,
      })
    }),
  )
}

export async function postOrderMessage(tenantId: string, orderId: string, body: string) {
  const trimmed = body.trim()
  if (!trimmed) throw new ApiError(400, 'Message body required')
  if (trimmed.length > 2000) throw new ApiError(400, 'Message too long')

  const order = await marketplaceDb.marketplaceOrder.findFirst({
    where: {
      id: orderId,
      OR: [{ buyerTenantId: tenantId }, { sellerTenantId: tenantId }],
    },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (['CANCELLED', 'COMPLETED'].includes(order.orderStatus)) {
    throw new ApiError(400, 'Cannot message on a closed order')
  }

  const msg = await marketplaceDb.marketplaceMessage.create({
    data: { orderId, senderTenantId: tenantId, body: trimmed },
  })

  if (tenantId === order.sellerTenantId) {
    const hoursSinceOrder = (Date.now() - order.createdAt.getTime()) / 3600000
    await recordMessageResponseTime(order.sellerTenantId, Math.min(hoursSinceOrder, 72))
  }

  const recipientTenantId =
    tenantId === order.buyerTenantId ? order.sellerTenantId : order.buyerTenantId
  await notifyMarketplaceEvent(recipientTenantId, 'marketplace.message.received', {
    orderId: orderId.slice(-8),
    preview: trimmed.slice(0, 120),
  })

  const profile = await getOrCreateMarketplaceProfile(tenantId)
  return redactCounterpartyPayload({
    id: msg.id,
    body: msg.body,
    createdAt: msg.createdAt.toISOString(),
    sender: toPublicProfile(profile),
    isMine: true,
  })
}
