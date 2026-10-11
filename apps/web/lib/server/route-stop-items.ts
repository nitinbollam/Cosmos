import { effectiveRestricted } from './age-restriction-rule'

/**
 * What is being delivered at each stop, for the driver app and the dispatch screens:
 * product code, name and quantity, plus whether it needs an age check. No prices or
 * costs — the driver only needs to know what to hand over and whether to check ID.
 *
 * Pure: the caller loads the order lines, SKUs and age policy. Kept free of DB imports
 * so it can be unit-tested on its own.
 */
export type StopItem = {
  skuCode: string
  name: string
  quantity: number
  ageRestricted: boolean
  minimumAge: number | null
}

export type StopItemsSummary = {
  items: StopItem[]
  /** Any item on this stop is age-restricted. */
  ageRestricted: boolean
  /** Highest minimum age among the stop's items, or null. */
  minimumAge: number | null
  /** The driver must confirm the recipient's age before this stop can be delivered. */
  ageCheckRequired: boolean
}

type SkuRow = { id: string; code: string; name: string; isTobacco: boolean; ageRestricted: boolean; minimumAge: number | null }
type AgePolicy = { enabled: boolean; minimumAge: number; requireDeliveryConfirmation: boolean }

export const NO_ITEMS: StopItemsSummary = { items: [], ageRestricted: false, minimumAge: null, ageCheckRequired: false }

export function buildStopItems(
  lines: Array<{ skuId: string; quantity: number }>,
  skus: Map<string, SkuRow>,
  policy: AgePolicy,
): StopItemsSummary {
  // One row per product, even if the order lists it on several lines.
  const bySku = new Map<string, StopItem>()
  for (const line of lines) {
    const sku = skus.get(line.skuId)
    const restricted = sku ? effectiveRestricted(sku, policy.minimumAge) : null
    const existing = bySku.get(line.skuId)
    if (existing) {
      existing.quantity += line.quantity
      continue
    }
    bySku.set(line.skuId, {
      skuCode: sku?.code ?? line.skuId,
      name: sku?.name ?? 'Unknown product',
      quantity: line.quantity,
      ageRestricted: Boolean(restricted),
      minimumAge: restricted?.minimumAge ?? null,
    })
  }
  const items = [...bySku.values()]
  const ages = items.filter((i) => i.ageRestricted).map((i) => i.minimumAge ?? policy.minimumAge)
  const ageRestricted = ages.length > 0
  return {
    items,
    ageRestricted,
    minimumAge: ageRestricted ? Math.max(...ages) : null,
    // Mirrors assertDeliveryAgeCompliance: only enforced when the company policy asks for it.
    ageCheckRequired: ageRestricted && policy.enabled && policy.requireDeliveryConfirmation,
  }
}
