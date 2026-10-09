/** Platform commission on fixed-price marketplace sales (10%). */
export const MARKETPLACE_FIXED_COMMISSION_RATE = 0.1

/** Platform commission on auction sales (10%). */
export const MARKETPLACE_AUCTION_COMMISSION_RATE = 0.1

/** @deprecated use MARKETPLACE_FIXED_COMMISSION_RATE */
export const MARKETPLACE_COMMISSION_RATE = MARKETPLACE_FIXED_COMMISSION_RATE

/** Days escrow is held after delivery confirmation before auto-release. */
export const MARKETPLACE_ESCROW_HOLD_DAYS = 3

/** Anti-snipe window (minutes). Bid in this window extends auction by same amount. */
export const MARKETPLACE_AUCTION_ANTI_SNIPE_MINUTES = 5

/** Allowed auction durations (days) when creating a listing. */
export const MARKETPLACE_AUCTION_DURATIONS = [3, 5, 7] as const

/** Minimum tenant age (days) before a seller can list inventory. */
export const MARKETPLACE_MIN_TENANT_TENURE_DAYS = 30

/** Suspend listing privileges when dispute rate exceeds this (0–1) with min orders. */
export const MARKETPLACE_DISPUTE_SUSPEND_RATE = 0.15

export const MARKETPLACE_DISPUTE_SUSPEND_MIN_ORDERS = 5

/** Buyer strikes before listing suspension. */
export const MARKETPLACE_MAX_BUYER_STRIKES = 3

/**
 * Admin-curated allowlist of SKU categories eligible for marketplace listing.
 */
export const MARKETPLACE_ALLOWED_CATEGORIES = [
  'Electronics',
  'Office Supplies',
  'Industrial Supplies',
  'Packaging',
  'Hardware',
  'Cleaning Supplies',
  'Safety Equipment',
  'Food Service Supplies',
  'General Merchandise',
] as const

export type MarketplaceAllowedCategory = (typeof MARKETPLACE_ALLOWED_CATEGORIES)[number]

export function commissionRateForListingType(listingType: 'FIXED' | 'AUCTION'): number {
  return listingType === 'AUCTION' ? MARKETPLACE_AUCTION_COMMISSION_RATE : MARKETPLACE_FIXED_COMMISSION_RATE
}

export function computeMarketplaceCommission(amountCents: number, listingType: 'FIXED' | 'AUCTION' = 'FIXED'): number {
  return Math.round(amountCents * commissionRateForListingType(listingType))
}

export function computeMarketplaceTransferCents(
  grossCents: number,
  listingType: 'FIXED' | 'AUCTION' = 'FIXED',
): number {
  return Math.max(0, grossCents - computeMarketplaceCommission(grossCents, listingType))
}
