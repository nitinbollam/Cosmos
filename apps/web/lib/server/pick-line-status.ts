export type PickLineStatus = 'PENDING' | 'PICKED' | 'SHORT'

export function derivePickLineStatus(
  quantity: number,
  pickedQty: number,
  markShort?: boolean,
): PickLineStatus {
  if (pickedQty <= 0) return 'PENDING'
  if (pickedQty >= quantity) return 'PICKED'
  if (markShort) return 'SHORT'
  return 'PENDING'
}
