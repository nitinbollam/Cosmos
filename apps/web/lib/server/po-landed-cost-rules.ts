/**
 * When landed costs (freight, duty, other charges) on a purchase order may change.
 *
 * A PO over the approval threshold is approved at the total it had when it was submitted. If freight
 * could then be raised, the PO could end up far above the amount anyone approved. So:
 *   - while the PO waits for approval its charges are locked (the approver is looking at one total);
 *   - once it is submitted (or partly received) the charges may still be corrected, but not raised
 *     past the larger of the approval threshold and the total it was approved at.
 * Lowering a charge, or leaving the total unchanged, is always allowed. Kept free of DB imports so it can be tested.
 */

export type LandedCostChange = {
  status: string
  currentTotal: number
  newTotal: number
  /** Company setting: POs above this total need approval. */
  threshold: number
  /** Highest total any approval for this PO was granted at (null if it never needed one). */
  approvedTotal: number | null
}

const money = (n: number) => `$${n.toFixed(2)}`

/** The reason the change is refused, or null when it is allowed. */
export function landedCostChangeBlocker(c: LandedCostChange): string | null {
  if (c.status === 'PENDING_APPROVAL') {
    return 'Landed costs can\'t be changed while this purchase order is waiting for approval. Ask the approver to reject it (it returns to draft), then edit and resubmit.'
  }
  if (c.status !== 'SUBMITTED' && c.status !== 'PARTIALLY_RECEIVED') return null
  if (c.newTotal <= c.currentTotal + 0.001) return null
  const limit = Math.max(c.threshold, c.approvedTotal ?? 0)
  if (c.newTotal <= limit + 0.001) return null
  const basis =
    c.approvedTotal != null && c.approvedTotal >= c.threshold
      ? `the ${money(c.approvedTotal)} it was approved for`
      : `the ${money(c.threshold)} approval threshold`
  return `This change takes the purchase order total to ${money(c.newTotal)}, above ${basis}. Lower the charges, or cancel this order and create a new one for approval.`
}
