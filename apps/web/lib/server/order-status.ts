export type OrderStatus =
  | 'PENDING'
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
  CONFIRMED: ['BACKORDERED', 'PROCESSING', 'CANCELLED'],
  BACKORDERED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['RETURNED'],
  CANCELLED: [],
  FAILED: [],
  RETURNED: [],
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
