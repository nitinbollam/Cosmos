import { ApprovalStatus, ApprovalType } from '@/generated/prisma-tenant'
import type { Prisma } from '@/generated/prisma-tenant'
import { tenantDb } from './db'
import { auditLog, type AuditInput } from './audit-log'
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
  return db.approvalRequest.create({
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
    orderBy: { createdAt: 'desc' },
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
  if (row.status !== ApprovalStatus.PENDING) throw notPending(row.status)
  // A second person has to sign off: otherwise the requester can approve past their own limit.
  if (decision.approve && row.requestedBy === decision.decidedBy) {
    throw new ApiError(403, "You can't approve your own request. Ask another manager or admin.")
  }

  // The decision and its audit event commit together, and only while the request is still pending: of two
  // approvers deciding at once, one wins and the other gets an error with nothing written.
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
      const now = await tx.approvalRequest.findFirst({ where: { id, tenantId }, select: { status: true } })
      throw notPending(now?.status ?? ApprovalStatus.APPROVED)
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
