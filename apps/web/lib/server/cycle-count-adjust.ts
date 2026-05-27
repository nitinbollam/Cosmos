/** Positive delta means inventory increase; negative means shrink. */
export function computeCycleCountDelta(systemQty: number, countedQty: number): number {
  return countedQty - systemQty
}

export function cycleCountLineNeedsAdjustment(systemQty: number, countedQty: number | null | undefined): boolean {
  if (countedQty == null) return false
  return computeCycleCountDelta(systemQty, countedQty) !== 0
}
