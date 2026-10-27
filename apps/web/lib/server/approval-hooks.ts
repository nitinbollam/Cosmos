import { ApprovalStatus, ApprovalType } from '@/generated/prisma-tenant'
import type { ApprovalRequest } from '@/generated/prisma-tenant'
import { purchasingDb } from './db'
import { PurchaseOrderStatus } from '@/generated/prisma-purchasing'
import { orderDb } from './db'
import { OrderStatus } from '@/generated/prisma-order'
import { submitPurchaseOrderAfterApproval } from './purchasing'
import { isOrderCancellationEligible } from './order-status'
import { ApiError } from './session'
import { rejectApprovedCancellationForStatus } from './approvals'

/** Side effects when an approval request is approved or rejected. */
export async function onApprovalDecided(tenantId: string, request: ApprovalRequest) {
  if (request.type === ApprovalType.ORDER_CANCELLATION) {
    if (request.status === ApprovalStatus.APPROVED) {
      const context = request.context as { reason?: string } | null
      const order = await orderDb.order.findFirst({ where: { id: request.subjectId, tenantId } })
      if (order && order.status !== 'CANCELLED' && !isOrderCancellationEligible(order.status)) {
        return rejectApprovedCancellationForStatus(
          tenantId,
          request.id,
          request.decidedBy ?? 'system',
          `Order is ${order.status.toLowerCase()} and is no longer eligible for cancellation`,
        )
      }
      const { cancelOrder } = await import('./orders')
      try {
        await cancelOrder(tenantId, request.subjectId, context?.reason?.trim() || 'Buyer cancellation request')
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) {
          const fresh = await orderDb.order.findFirst({ where: { id: request.subjectId, tenantId } })
          if (fresh && fresh.status !== 'CANCELLED' && !isOrderCancellationEligible(fresh.status)) {
            return rejectApprovedCancellationForStatus(
              tenantId,
              request.id,
              request.decidedBy ?? 'system',
              `Order is ${fresh.status.toLowerCase()} and is no longer eligible for cancellation`,
            )
          }
        }
        throw err
      }
    }
    return request
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
