import { marketplaceDb } from './db'
import { applyRatingToProfile } from './marketplace-profiles'
import { ApiError } from './session'

export type PublicMarketplaceRating = {
  stars: number
  comment: string | null
  createdAt: string
}

export async function rateMarketplaceOrder(
  raterTenantId: string,
  orderId: string,
  stars: number,
  comment?: string,
) {
  if (stars < 1 || stars > 5) throw new ApiError(400, 'stars must be between 1 and 5')

  const order = await marketplaceDb.marketplaceOrder.findFirst({
    where: {
      id: orderId,
      OR: [{ buyerTenantId: raterTenantId }, { sellerTenantId: raterTenantId }],
      orderStatus: { in: ['DELIVERED', 'COMPLETED'] },
    },
    include: { rating: true },
  })
  if (!order) throw new ApiError(404, 'Order not found or not eligible for rating')
  if (order.rating) throw new ApiError(400, 'Order already rated')

  const ratedTenantId =
    order.buyerTenantId === raterTenantId ? order.sellerTenantId : order.buyerTenantId

  const rating = await marketplaceDb.marketplaceRating.create({
    data: {
      orderId,
      raterTenantId,
      ratedTenantId,
      stars,
      comment: comment?.trim() || null,
    },
  })

  await applyRatingToProfile(ratedTenantId, stars)

  return {
    stars: rating.stars,
    comment: rating.comment,
    createdAt: rating.createdAt.toISOString(),
  } satisfies PublicMarketplaceRating
}
