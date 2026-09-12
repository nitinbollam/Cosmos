import type { SalesChannelType } from '@/generated/prisma-sales-channels'

type SkuEligibilityFields = {
  isActive: boolean
  isTobacco: boolean
  isAlcohol: boolean
  isRegulated: boolean
}

export function isChannelEligible(sku: SkuEligibilityFields, channelType: SalesChannelType): boolean {
  if (!sku.isActive) return false
  if (channelType === 'SHOPIFY') return true
  return !sku.isTobacco && !sku.isAlcohol && !sku.isRegulated
}
