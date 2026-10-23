/**
 * Splitting a quantity across the lots a place holds (PLR-175). A van carries stock by lot, so a
 * load, an unload or a return moves it lot by lot instead of as one anonymous number. Pure.
 */
export type LotLevel = { batchId: string; available: number; expiry: Date | null; recalled?: boolean }

export type BatchTake = { batchId: string; quantity: number }

/**
 * First to expire first. Unlabelled stock ('') goes last, lots with no expiry after dated ones.
 * `skipRecalled` keeps a recalled lot off a van going out; coming back it is taken like any other.
 * What the lots cannot cover is returned as `short`, so the caller decides whether that is an error.
 */
export function splitAcrossBatches(
  levels: ReadonlyArray<LotLevel>,
  quantity: number,
  opts: { skipRecalled?: boolean } = {},
): { takes: BatchTake[]; short: number } {
  const rank = (l: LotLevel) => (l.batchId === '' ? 2 : l.expiry ? 0 : 1)
  const usable = levels
    .filter((l) => l.available > 0 && !(opts.skipRecalled && l.recalled))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.expiry?.getTime() ?? 0) - (b.expiry?.getTime() ?? 0) ||
        a.batchId.localeCompare(b.batchId),
    )
  const takes: BatchTake[] = []
  let remaining = quantity
  for (const l of usable) {
    if (remaining <= 0) break
    const take = Math.min(remaining, l.available)
    takes.push({ batchId: l.batchId, quantity: take })
    remaining -= take
  }
  return { takes, short: Math.max(0, remaining) }
}

/** Takes the first `count` units off a plan, for the part of a move that was damaged. */
export function leadingUnits(takes: ReadonlyArray<BatchTake>, count: number): BatchTake[] {
  const out: BatchTake[] = []
  let remaining = count
  for (const t of takes) {
    if (remaining <= 0) break
    const q = Math.min(remaining, t.quantity)
    out.push({ batchId: t.batchId, quantity: q })
    remaining -= q
  }
  return out
}
