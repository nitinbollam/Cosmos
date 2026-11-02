/**
 * Stock valuation at moving weighted average cost (ticket 50).
 *
 * Each stock level (SKU + warehouse + batch) carries `averageCost`: receipts blend in at their cost,
 * transfers carry the source's cost to the destination, returns come back at the cost they shipped at,
 * and every outflow (shipment, transfer out, adjustment) is valued at the current average. The stock
 * ledger records that unit cost and COGS is the sum of what actually shipped, so the two always agree.
 *
 * Stock received before averages existed has `averageCost = null`; it is valued at the SKU's standard
 * cost, explicitly, until a receipt or transfer gives it an average.
 */
import { money, roundMoney, sum, type Decimal, type MoneyValue } from './money'

/** Unit costs are kept to 4 places; money totals are rounded to cents once, at the end. */
const UNIT_COST_PLACES = 4

export function unitCost(value: MoneyValue): string {
  return money(value).toDecimalPlaces(UNIT_COST_PLACES).toString()
}

/** The cost to value stock at: its average when known, else the SKU's standard cost, else 0. */
export function effectiveUnitCost(averageCost: MoneyValue | null | undefined, standardCost: MoneyValue | null | undefined): string {
  if (averageCost != null) return unitCost(averageCost)
  if (standardCost != null) return unitCost(standardCost)
  return '0'
}

/**
 * New average after `qtyIn` units arrive at `costIn` on top of `onHandBefore` units valued at
 * `costBefore` (already resolved with `effectiveUnitCost`). Nothing (or less than nothing) on hand
 * means the new units set the average.
 */
export function blendAverage(onHandBefore: number, costBefore: MoneyValue, qtyIn: number, costIn: MoneyValue): string {
  if (qtyIn <= 0) return unitCost(costBefore)
  if (onHandBefore <= 0) return unitCost(costIn)
  const total = money(costBefore).times(onHandBefore).plus(money(costIn).times(qtyIn))
  return unitCost(total.div(onHandBefore + qtyIn))
}

/** Total value of lines at their unit cost, rounded to cents once. */
export function valueOf(lines: Iterable<{ quantity: number; unitCost: MoneyValue }>): Decimal {
  const parts: Decimal[] = []
  for (const l of lines) parts.push(money(l.unitCost).times(l.quantity))
  return roundMoney(sum(parts))
}

/**
 * Per-SKU unit cost an order actually shipped at, weighted by quantity across its shipments.
 * Ledger rows with cost 0 were written before shipments were valued and are left out; a SKU with no
 * valued shipment falls back to `standardCost`.
 */
export function shippedUnitCosts(
  shipments: Array<{ skuId: string; quantityDelta: number; unitCost: MoneyValue }>,
  standardCost: Map<string, MoneyValue>,
  skuIds: Iterable<string>,
): Map<string, string> {
  const qty = new Map<string, number>()
  const value = new Map<string, Decimal>()
  for (const s of shipments) {
    const q = Math.abs(s.quantityDelta)
    if (q === 0 || money(s.unitCost).isZero()) continue
    qty.set(s.skuId, (qty.get(s.skuId) ?? 0) + q)
    value.set(s.skuId, (value.get(s.skuId) ?? money('0')).plus(money(s.unitCost).times(q)))
  }
  const out = new Map<string, string>()
  for (const skuId of skuIds) {
    const q = qty.get(skuId)
    out.set(skuId, q ? unitCost(value.get(skuId)!.div(q)) : effectiveUnitCost(null, standardCost.get(skuId)))
  }
  return out
}
