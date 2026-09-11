import { marketplaceDb } from './db'
import * as stripe from './stripe'
import { checkAndSuspendForDisputes } from './marketplace-trust'
import { ApiError } from './session'

export async function resolveMarketplaceDispute(
  orderId: string,
  input: { resolutionNotes: string; refundBuyer?: boolean; releaseToSeller?: boolean },
) {
  const order = await marketplaceDb.marketplaceOrder.findUnique({
    where: { id: orderId },
    include: { dispute: true },
  })
  if (!order?.dispute) throw new ApiError(404, 'Dispute not found')
  if (order.dispute.status !== 'OPEN') throw new ApiError(400, 'Dispute is not open')

  if (input.refundBuyer && order.stripePaymentIntentId && stripe.isStripeConfigured()) {
    const client = stripe.getStripeClient()
    await client.refunds.create({ payment_intent: order.stripePaymentIntentId })
    await marketplaceDb.marketplaceOrder.update({
      where: { id: orderId },
      data: { paymentStatus: 'REFUNDED', orderStatus: 'CANCELLED' },
    })
  } else if (input.releaseToSeller) {
    const { releaseMarketplaceEscrow } = await import('./marketplace-orders')
    await marketplaceDb.marketplaceOrder.update({
      where: { id: orderId },
      data: { orderStatus: 'DELIVERED', escrowReleaseAt: new Date(0) },
    })
    await releaseMarketplaceEscrow(orderId)
  } else {
    await marketplaceDb.marketplaceOrder.update({
      where: { id: orderId },
      data: { orderStatus: 'COMPLETED' },
    })
  }

  await marketplaceDb.marketplaceDispute.update({
    where: { orderId },
    data: {
      status: 'RESOLVED',
      resolutionNotes: input.resolutionNotes.trim() || 'Resolved by ops',
      refundIssued: Boolean(input.refundBuyer),
    },
  })

  await checkAndSuspendForDisputes(order.sellerTenantId)
  return { orderId, status: 'RESOLVED' }
}

export async function closeMarketplaceDispute(orderId: string, resolutionNotes: string) {
  const dispute = await marketplaceDb.marketplaceDispute.findUnique({ where: { orderId } })
  if (!dispute) throw new ApiError(404, 'Dispute not found')
  await marketplaceDb.marketplaceDispute.update({
    where: { orderId },
    data: { status: 'CLOSED', resolutionNotes: resolutionNotes.trim() || 'Closed by ops' },
  })
  return { orderId, status: 'CLOSED' }
}
