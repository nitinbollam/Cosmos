export type OrderStatus =
  | 'PENDING'
  | 'AWAITING_APPROVAL'
  | 'CONFIRMED'
  | 'BACKORDERED'
  | 'PROCESSING'
  | 'PACKED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | 'RETURNED'

const FORWARD: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'BACKORDERED', 'PROCESSING', 'CANCELLED', 'FAILED'],
  AWAITING_APPROVAL: ['CONFIRMED', 'BACKORDERED', 'CANCELLED', 'FAILED'],
  CONFIRMED: ['BACKORDERED', 'PROCESSING', 'CANCELLED', 'FAILED'],
  BACKORDERED: ['PROCESSING', 'CANCELLED', 'FAILED'],
  PROCESSING: ['PACKED', 'CANCELLED', 'FAILED'],
  PACKED: ['SHIPPED'],
  SHIPPED: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['RETURNED'],
  CANCELLED: [],
  FAILED: [],
  RETURNED: [],
}

/** Cancellations are only valid before warehouse packing begins. */
export function isOrderCancellationEligible(status: string): status is Extract<OrderStatus, 'PENDING' | 'AWAITING_APPROVAL' | 'CONFIRMED' | 'BACKORDERED' | 'PROCESSING'> {
  return ['PENDING', 'AWAITING_APPROVAL', 'CONFIRMED', 'BACKORDERED', 'PROCESSING'].includes(status)
}

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true
  return FORWARD[from]?.includes(to) ?? false
}

export function fulfillmentTaskStatusToOrderStatus(
  taskStatus: string,
): 'PROCESSING' | 'PACKED' | 'SHIPPED' | null {
  switch (taskStatus) {
    case 'PENDING':
    case 'PICKING':
      return 'PROCESSING'
    case 'PACKED':
      return 'PACKED'
    case 'DISPATCHED':
      return 'SHIPPED'
    default:
      return null
  }
}
