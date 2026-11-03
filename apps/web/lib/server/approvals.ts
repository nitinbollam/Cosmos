import { ApprovalStatus, ApprovalType } from '@/generated/prisma-tenant'
import type { Prisma } from '@/generated/prisma-tenant'
import { tenantDb } from './db'
import { auditLog, type AuditInput } from './audit-log'
import { swallowed } from './fire-and-forget'
import { ApiError } from './session'

export type CreateApprovalInput = {
  type: ApprovalType
  subjectId: string
  requestedBy: string
  context: Record<string, unknown>
  /** Chosen by the caller when a retry must find the same request (see purchase requisitions). */
  id?: string
}

export async function createApprovalRequest(tenantId: string, input: CreateApprovalInput, db: Prisma.TransactionClient = tenantDb) {
  const row = await db.approvalRequest.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      tenantId,
      type: input.type,
      subjectId: input.subjectId,
      requestedBy: input.requestedBy,
      context: input.context as never,
      status: ApprovalStatus.PENDING,
    },
  })
  // Tell the approvers now. Inside a caller's transaction the row isn't committed yet, so leave it to the
  // reminder job, which sends the same notice within minutes (approval-reminders.ts).
  if (db === tenantDb) {
    void import('./approval-reminders')
      .then(({ notifyApprovalRequested }) => notifyApprovalRequested(tenantId, row.id))
      .catch(swallowed('approvals.notifyApprovalRequested'))
  }
  return row
}

/** Create one pending request for a subject, rechecking inside a serializable transaction. */
export async function createPendingApprovalRequest(tenantId: string, input: CreateApprovalInput) {
  const where = { tenantId, type: input.type, subjectId: input.subjectId, status: ApprovalStatus.PENDING }
  try {
    return await tenantDb.$transaction(
      async (tx) => {
        const existing = await tx.approvalRequest.findFirst({ where, orderBy: { createdAt: 'desc' } })
        if (existing) return { request: existing, duplicate: true }
        const request = await tx.approvalRequest.create({
          data: {
            ...(input.id ? { id: input.id } : {}),
            tenantId,
            type: input.type,
            subjectId: input.subjectId,
            requestedBy: input.requestedBy,
            context: input.context as never,
            status: ApprovalStatus.PENDING,
          },
        })
        return { request, duplicate: false }
      },
      { isolationLevel: 'Serializable' },
    ).then((result) => {
      if (!result.duplicate) {
        // Notify only after commit; the reminder worker remains the retry path if this is lost.
        void import('./approval-reminders')
          .then(({ notifyApprovalRequested }) => notifyApprovalRequested(tenantId, result.request.id))
          .catch(swallowed('approvals.notifyApprovalRequested'))
      }
      return result
    })
  } catch (err) {
    // A concurrent serializable transaction can win after our read. Return that request rather
    // than surfacing a conflict or creating a second pending item.
    const existing = await tenantDb.approvalRequest.findFirst({ where, orderBy: { createdAt: 'desc' } })
    if (existing) return { request: existing, duplicate: true }
    throw err
  }
}

export async function listApprovalRequests(
  tenantId: string,
  filters?: { type?: ApprovalType; status?: ApprovalStatus },
) {
  return tenantDb.approvalRequest.findMany({
    where: {
      tenantId,
      ...(filters?.type ? { type: filters.type } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
    },
    // Pending requests oldest first, so the longest-waiting is on top; decided ones newest first.
    orderBy: { createdAt: filters?.status === ApprovalStatus.PENDING ? 'asc' : 'desc' },
  })
}

export async function getApprovalRequest(tenantId: string, id: string) {
  const row = await tenantDb.approvalRequest.findFirst({ where: { id, tenantId } })
  if (!row) throw new ApiError(404, 'Approval request not found')
  return row
}

export async function findPendingApprovalForSubject(
  tenantId: string,
  type: ApprovalType,
  subjectId: string,
) {
  return tenantDb.approvalRequest.findFirst({
    where: { tenantId, type, subjectId, status: ApprovalStatus.PENDING },
    orderBy: { createdAt: 'desc' },
  })
}

export async function findLatestApprovalForSubject(tenantId: string, type: ApprovalType, subjectId: string) {
  return tenantDb.approvalRequest.findFirst({
    where: { tenantId, type, subjectId },
    orderBy: { createdAt: 'desc' },
  })
}

function notPending(status: ApprovalStatus): ApiError {
  return status === ApprovalStatus.CANCELLED
    ? new ApiError(400, 'Approval request was cancelled')
    : new ApiError(400, 'Approval request is already decided')
}

export async function decideApprovalRequest(
  tenantId: string,
  id: string,
  decision: { approve: boolean; decidedBy: string; rejectReason?: string },
) {
  const row = await getApprovalRequest(tenantId, id)
  if (row.status !== ApprovalStatus.PENDING) {
    const sameDecision =
      (decision.approve && row.status === ApprovalStatus.APPROVED) ||
      (!decision.approve && row.status === ApprovalStatus.REJECTED)
    if (sameDecision) return row
    throw notPending(row.status)
  }
  // A second person has to sign off: otherwise the requester can approve past their own limit.
  if (decision.approve && row.requestedBy === decision.decidedBy) {
    throw new ApiError(403, "You can't approve your own request. Ask another manager or admin.")
  }

  // The decision and its audit event commit together, and only while the request is still pending: of two
  // approvers deciding at once, one wins. A retry of the winning decision is an idempotent read.
  return tenantDb.$transaction(async (tx) => {
    const claimed = await tx.approvalRequest.updateMany({
      where: { id, tenantId, status: ApprovalStatus.PENDING },
      data: {
        status: decision.approve ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
        decidedBy: decision.decidedBy,
        decidedAt: new Date(),
        rejectReason: decision.approve ? null : decision.rejectReason?.trim() || 'Rejected',
      },
    })
    if (claimed.count !== 1) {
      const current = await tx.approvalRequest.findFirstOrThrow({ where: { id, tenantId } })
      throw notPending(current.status)
    }

    await auditLog(
      tenantId,
      {
        action: decision.approve ? 'approval.approved' : 'approval.rejected',
        entityType: 'ApprovalRequest',
        entityId: id,
        userId: decision.decidedBy,
        metadata: {
          type: row.type,
          subjectId: row.subjectId,
          context: row.context,
          rejectReason: decision.rejectReason ?? null,
        },
      },
      tx,
    )

    return tx.approvalRequest.findFirstOrThrow({ where: { id, tenantId } })
  })
}

/**
 * Closes a pending request without a decision (its subject was withdrawn or cancelled). Conditional on PENDING, so
 * it never overwrites a decision. The optional audit event is written in the same transaction, whether or not this
 * call was the one that closed the request; give it a fixed `id` so a retry does not log it twice.
 * Returns true when this call moved the request to CANCELLED.
 */
export async function cancelApprovalRequest(
  tenantId: string,
  id: string,
  opts: { cancelReason: string; audit?: AuditInput & { id: string } },
): Promise<boolean> {
  return tenantDb.$transaction(async (tx) => {
    const res = await tx.approvalRequest.updateMany({
      where: { id, tenantId, status: ApprovalStatus.PENDING },
      data: { status: ApprovalStatus.CANCELLED, cancelReason: opts.cancelReason, decidedAt: new Date() },
    })
    if (opts.audit) {
      const logged = await tx.auditEvent.findFirst({ where: { id: opts.audit.id, tenantId }, select: { id: true } })
      if (!logged) await auditLog(tenantId, opts.audit, tx)
    }
    return res.count === 1
  })
}

export async function rejectApprovedCancellationForStatus(
  tenantId: string,
  id: string,
  decidedBy: string,
  reason: string,
) {
  return tenantDb.$transaction(async (tx) => {
    const moved = await tx.approvalRequest.updateMany({
      where: { id, tenantId, type: ApprovalType.ORDER_CANCELLATION, status: ApprovalStatus.APPROVED },
      data: {
        status: ApprovalStatus.REJECTED,
        decidedBy,
        decidedAt: new Date(),
        rejectReason: reason,
      },
    })
    const updated = await tx.approvalRequest.findFirstOrThrow({ where: { id, tenantId } })
    if (moved.count === 1) {
      await auditLog(
        tenantId,
        {
          action: 'approval.rejected',
          entityType: 'ApprovalRequest',
          entityId: id,
          userId: decidedBy,
          metadata: { type: updated.type, subjectId: updated.subjectId, rejectReason: reason },
        },
        tx,
      )
    }
    return updated
  })
}
