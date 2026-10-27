export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'SUBMITTED'
  | 'PARTIALLY_RECEIVED'
  | 'CLOSED'
  | 'CANCELLED'

const LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  SUBMITTED: 'Submitted',
  PARTIALLY_RECEIVED: 'Partially Received',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
}

export function purchaseOrderStatusLabel(status: PurchaseOrderStatus): string {
  return LABELS[status]
}
