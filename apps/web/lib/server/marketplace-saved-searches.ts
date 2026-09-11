import { marketplaceDb } from './db'
import { notifySavedSearchMatch } from './marketplace-notifications'
import { ApiError } from './session'

export async function listSavedSearches(tenantId: string) {
  return marketplaceDb.marketplaceSavedSearch.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

export async function createSavedSearch(
  tenantId: string,
  dto: { query?: string; category?: string; notifyEmail?: boolean },
) {
  if (!dto.query?.trim() && !dto.category?.trim()) {
    throw new ApiError(400, 'query or category required')
  }
  return marketplaceDb.marketplaceSavedSearch.create({
    data: {
      tenantId,
      query: dto.query?.trim() || null,
      category: dto.category?.trim() || null,
      notifyEmail: dto.notifyEmail ?? true,
    },
  })
}

export async function deleteSavedSearch(tenantId: string, id: string) {
  const row = await marketplaceDb.marketplaceSavedSearch.findFirst({ where: { id, tenantId } })
  if (!row) throw new ApiError(404, 'Saved search not found')
  await marketplaceDb.marketplaceSavedSearch.delete({ where: { id } })
  return { deleted: true }
}

/** Called when a listing goes live — notify matching saved searches. */
export async function notifyMatchingSavedSearches(listing: {
  title: string
  category: string
  description: string | null
}) {
  const searches = await marketplaceDb.marketplaceSavedSearch.findMany({
    where: { notifyEmail: true },
    take: 500,
  })
  const hay = `${listing.title} ${listing.description ?? ''} ${listing.category}`.toLowerCase()
  for (const s of searches) {
    const catOk = !s.category || listing.category.toLowerCase() === s.category.toLowerCase()
    const qOk = !s.query || hay.includes(s.query.toLowerCase())
    if (catOk && qOk) {
      await notifySavedSearchMatch(s.tenantId, listing.title, listing.category)
    }
  }
}
