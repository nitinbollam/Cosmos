import { randomBytes } from 'node:crypto'
import { marketplaceDb } from './db'
import { ApiError } from './session'

export type PublicMarketplaceProfile = {
  handle: string
  ratingAvg: number
  ratingCount: number
  completedOrderCount: number
  avgResponseTimeHours: number
  joinedAt: string
}

function generateHandle(): string {
  return `seller-${randomBytes(4).toString('hex')}`
}

export function toPublicProfile(profile: {
  handle: string
  ratingAvg: number
  ratingCount: number
  completedOrderCount: number
  avgResponseTimeHours?: number
  optedInAt: Date
}): PublicMarketplaceProfile {
  return {
    handle: profile.handle,
    ratingAvg: profile.ratingAvg,
    ratingCount: profile.ratingCount,
    completedOrderCount: profile.completedOrderCount,
    avgResponseTimeHours: profile.avgResponseTimeHours ?? 0,
    joinedAt: profile.optedInAt.toISOString(),
  }
}

export async function getOrCreateMarketplaceProfile(tenantId: string) {
  const existing = await marketplaceDb.marketplaceProfile.findUnique({ where: { tenantId } })
  if (existing) return existing

  for (let attempt = 0; attempt < 5; attempt++) {
    const handle = generateHandle()
    try {
      return await marketplaceDb.marketplaceProfile.create({
        data: { tenantId, handle },
      })
    } catch {
      // handle collision — retry
    }
  }
  throw new ApiError(500, 'Could not create marketplace profile')
}

export async function getPublicProfileByTenantId(tenantId: string): Promise<PublicMarketplaceProfile | null> {
  const profile = await marketplaceDb.marketplaceProfile.findUnique({ where: { tenantId } })
  if (!profile) return null
  return toPublicProfile(profile)
}

export async function incrementCompletedOrders(tenantId: string) {
  await marketplaceDb.marketplaceProfile.update({
    where: { tenantId },
    data: { completedOrderCount: { increment: 1 } },
  })
}

export async function applyRatingToProfile(tenantId: string, stars: number) {
  const profile = await marketplaceDb.marketplaceProfile.findUnique({ where: { tenantId } })
  if (!profile) return
  const nextCount = profile.ratingCount + 1
  const nextAvg = (profile.ratingAvg * profile.ratingCount + stars) / nextCount
  await marketplaceDb.marketplaceProfile.update({
    where: { tenantId },
    data: { ratingCount: nextCount, ratingAvg: nextAvg },
  })
}
