/** Extract linked order id from route stop address JSON. */
export function orderIdFromStopAddress(address: unknown): string | null {
  if (!address || typeof address !== 'object') return null
  const row = address as Record<string, unknown>
  const id = row.orderId ?? row.order_id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}
