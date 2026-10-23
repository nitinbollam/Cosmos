/**
 * The label a person reads for an order: ORD-1042 when the order has a number, otherwise the tail of its
 * internal id so orders created before numbering still show something stable until they are backfilled.
 * One function for every screen, so the same order never reads two different ways.
 */
export function orderLabel(orderId: string | null | undefined, orderNumber?: number | null): string {
  if (orderNumber != null) return `ORD-${orderNumber}`
  const id = orderId ?? ''
  if (!id) return ''
  if (id.startsWith('seed_ord_')) return `ORD-${id.replace('seed_ord_', '').toUpperCase()}`
  return `ORD-${id.slice(-6).toUpperCase()}`
}
