import assert from 'node:assert/strict'
import test from 'node:test'
import { purchaseOrderStatusLabel, type PurchaseOrderStatus } from './purchasing-status'

test('purchase order statuses use title-case labels', () => {
  const labels: Record<PurchaseOrderStatus, string> = {
    DRAFT: 'Draft',
    PENDING_APPROVAL: 'Pending Approval',
    SUBMITTED: 'Submitted',
    PARTIALLY_RECEIVED: 'Partially Received',
    CLOSED: 'Closed',
    CANCELLED: 'Cancelled',
  }

  for (const [status, label] of Object.entries(labels) as Array<[PurchaseOrderStatus, string]>) {
    assert.equal(purchaseOrderStatusLabel(status), label)
  }
})
