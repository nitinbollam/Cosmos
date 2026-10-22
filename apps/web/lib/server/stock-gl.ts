/**
 * What a stock adjustment is worth in the books (PLR-174). Units lost are an expense at the SKU's
 * cost (Dr Inventory Shrinkage, Cr Inventory); units found reverse it. Pure, so it is tested alone.
 */
import { money, roundMoney, type MoneyValue } from './money'

export const SHRINKAGE_ACCOUNT = { code: '5100', name: 'Inventory Shrinkage' } as const

export type AdjustmentPosting = { kind: 'STOCK_WRITE_OFF_JOURNAL' | 'STOCK_FOUND_JOURNAL'; amount: string }

/** The journal an adjustment needs, or null when it is worth nothing (no cost on the SKU, no change). */
export function adjustmentPosting(unitCost: MoneyValue | null | undefined, quantityDelta: number): AdjustmentPosting | null {
  if (!Number.isInteger(quantityDelta) || quantityDelta === 0) return null
  const cost = unitCost == null ? money('0') : money(unitCost)
  const amount = roundMoney(cost.times(Math.abs(quantityDelta)))
  if (!amount.gt(0)) return null
  return { kind: quantityDelta < 0 ? 'STOCK_WRITE_OFF_JOURNAL' : 'STOCK_FOUND_JOURNAL', amount: amount.toString() }
}
