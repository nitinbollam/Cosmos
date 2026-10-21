export type PickLineStatus = 'PENDING' | 'PICKED' | 'SHORT'

export function derivePickLineStatus(
  quantity: number,
  pickedQty: number,
  markShort?: boolean,
): PickLineStatus {
  if (pickedQty >= quantity && pickedQty > 0) return 'PICKED'
  // Nothing found at all is a short pick too. Without this a line the picker cannot find could never
  // be closed, so the task could never be packed.
  if (markShort) return 'SHORT'
  return 'PENDING'
}
