import { ApprovalStatus, ApprovalType } from '@/generated/prisma-tenant'
import type { ApprovalRequest } from '@/generated/prisma-tenant'
import { purchasingDb } from './db'
import { PurchaseOrderStatus } from '@/generated/prisma-purchasing'
import { orderDb } from './db'
import { OrderStatus } from '@/generated/prisma-order'
import { submitPurchaseOrderAfterApproval } from './purchasing'

/** Checks that run before an approver's decision is recorded. Throws to refuse the decision. */
export async function beforeApprovalDecided(tenantId: string, request: ApprovalRequest) {
  if (request.type === ApprovalType.PURCHASE_REQUISITION) {
    const { assertRequisitionApprovalDecidable } = await import('./requisition-approval-sync')
    await assertRequisitionApprovalDecidable(tenantId, request)
  }
}

/** Side effects when an approval request is approved or rejected. */
export async function onApprovalDecided(tenantId: string, request: ApprovalRequest) {
  // A request closed as CANCELLED was never decided: none of the approve/reject side effects below apply.
  if (request.status !== ApprovalStatus.APPROVED && request.status !== ApprovalStatus.REJECTED) return
  if (request.type === ApprovalType.PURCHASE_REQUISITION) {
    const { applyRequisitionDecision } = await import('./requisition-approval-sync')
    try {
      await applyRequisitionDecision(tenantId, request)
    } catch (err) {
      // The decision is committed in the tenant database; reading the requisition or the reconciler copies it over.
      console.error('[requisitions] applying approval decision failed; recovery will retry:', err)
    }
    return
  }
  if (request.status === ApprovalStatus.APPROVED && request.type === ApprovalType.PURCHASE_ORDER) {
    await submitPurchaseOrderAfterApproval(tenantId, request.subjectId)
  }
  if (request.status === ApprovalStatus.REJECTED && request.type === ApprovalType.PURCHASE_ORDER) {
    const po = await purchasingDb.purchaseOrder.findFirst({
      where: { id: request.subjectId, tenantId },
    })
    await purchasingDb.purchaseOrder.updateMany({
      where: { id: request.subjectId, tenantId, status: PurchaseOrderStatus.PENDING_APPROVAL },
      data: {
        status: PurchaseOrderStatus.DRAFT,
        notes: appendRejectNote(po?.notes, request.rejectReason),
      },
    })
  }
  if (request.status === ApprovalStatus.REJECTED && request.type === ApprovalType.CREDIT_LIMIT_OVERRIDE) {
    await orderDb.order.updateMany({
      where: { id: request.subjectId, tenantId, status: OrderStatus.AWAITING_APPROVAL },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), failureReason: request.rejectReason ?? 'Credit limit override rejected' },
    })
  }
  if (request.status === ApprovalStatus.APPROVED && request.type === ApprovalType.CREDIT_LIMIT_OVERRIDE) {
    const { resumeOrderAfterCreditApproval } = await import('./orders')
    await resumeOrderAfterCreditApproval(tenantId, request.subjectId)
  }
  if (request.status === ApprovalStatus.APPROVED && request.type === ApprovalType.CREDIT_LIMIT_INCREASE) {
    const { applyApprovedCreditIncrease } = await import('./sales-rep')
    await applyApprovedCreditIncrease(tenantId, request)
  }
  if (request.type === ApprovalType.EXPENSE_REPORT) {
    const { decideExpenseReport } = await import('./expense-reports')
    await decideExpenseReport(tenantId, request.subjectId, {
      approve: request.status === ApprovalStatus.APPROVED,
      decidedBy: request.decidedBy ?? 'system',
      rejectReason: request.rejectReason ?? undefined,
    })
  }
}

function appendRejectNote(existing: string | null | undefined, reason: string | null | undefined): string {
  const base = existing?.trim() ?? ''
  const msg = reason?.trim() ? `Approval rejected: ${reason.trim()}` : 'Approval rejected'
  return base ? `${base}\n${msg}` : msg
}
