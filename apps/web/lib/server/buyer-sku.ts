/**
 * What a buyer-portal account may see of a SKU: product details, their own price and how many are
 * available. Cost, minimum price and internal stock figures (on hand, reserved, reorder levels) stay
 * on the server. This is a whitelist, so a field added to SKU later is hidden from buyers by default.
 * A drop-ship product shows only as `dropShip: true`; which supplier ships it stays internal.
 */
const BUYER_SKU_FIELDS = [
  'id',
  'code',
  'name',
  'description',
  'category',
  'subcategory',
  'barcode',
  'unitOfMeasure',
  'weightGrams',
  'isTobacco',
  'isAlcohol',
  'isRegulated',
  'ageRestricted',
  'minimumAge',
  'isActive',
  'isKit',
  'imageUrls',
  'attributes',
  'createdAt',
  // Pricing as resolved for this buyer (contract price when they have one).
  'price',
  'listPrice',
  'contractPrice',
  'priceSource',
  'quantityAvailable',
] as const

export type BuyerSku = Partial<Record<(typeof BUYER_SKU_FIELDS)[number], unknown>> & { dropShip?: boolean }

export function toBuyerSku(sku: object): BuyerSku {
  const src = sku as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of BUYER_SKU_FIELDS) {
    if (key in src) out[key] = src[key]
  }
  if ('dropShipSupplierId' in src) out.dropShip = Boolean(src.dropShipSupplierId)
  return out
}
