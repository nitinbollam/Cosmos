import { ApprovalStatus, ApprovalType } from '@/generated/prisma-tenant'
import { tenantDb } from './db'
import { auditLog } from './audit-log'
import { ApiError } from './session'

export type CreateApprovalInput = {
  type: ApprovalType
  subjectId: string
  requestedBy: string
  context: Record<string, unknown>
}

export async function createApprovalRequest(tenantId: string, input: CreateApprovalInput) {
  return tenantDb.approvalRequest.create({
    data: {
      tenantId,
      type: input.type,
      subjectId: input.subjectId,
      requestedBy: input.requestedBy,
      context: input.context as never,
      status: ApprovalStatus.PENDING,
    },
  })
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
    )
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

export async function findLatestApprovalForSubject(tenantId: string, type: ApprovalType, subjectId: string) {
  return tenantDb.approvalRequest.findFirst({
    where: { tenantId, type, subjectId },
    orderBy: { createdAt: 'desc' },
  })
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
    throw new ApiError(400, 'Approval request is already decided')
  }
  // A second person has to sign off: otherwise the requester can approve past their own limit.
  if (decision.approve && row.requestedBy === decision.decidedBy) {
    throw new ApiError(403, "You can't approve your own request. Ask another manager or admin.")
  }

  const moved = await tenantDb.approvalRequest.updateMany({
    where: { id, tenantId, status: ApprovalStatus.PENDING },
    data: {
      status: decision.approve ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
      decidedBy: decision.decidedBy,
      decidedAt: new Date(),
      rejectReason: decision.approve ? null : decision.rejectReason?.trim() || 'Rejected',
    },
  })
  if (moved.count !== 1) {
    const current = await getApprovalRequest(tenantId, id)
    const sameDecision =
      (decision.approve && current.status === ApprovalStatus.APPROVED) ||
      (!decision.approve && current.status === ApprovalStatus.REJECTED)
    if (sameDecision) return current
    throw new ApiError(409, 'This approval request was already decided')
  }
  const updated = await getApprovalRequest(tenantId, id)

  await auditLog(tenantId, {
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
  })

  return updated
}

export async function rejectApprovedCancellationForStatus(
  tenantId: string,
  id: string,
  decidedBy: string,
  reason: string,
) {
  const moved = await tenantDb.approvalRequest.updateMany({
    where: { id, tenantId, type: ApprovalType.ORDER_CANCELLATION, status: ApprovalStatus.APPROVED },
    data: {
      status: ApprovalStatus.REJECTED,
      decidedBy,
      decidedAt: new Date(),
      rejectReason: reason,
    },
  })
  const updated = await getApprovalRequest(tenantId, id)
  if (moved.count === 1) {
    await auditLog(tenantId, {
      action: 'approval.rejected',
      entityType: 'ApprovalRequest',
      entityId: id,
      userId: decidedBy,
      metadata: { type: updated.type, subjectId: updated.subjectId, rejectReason: reason },
    })
  }
  return updated
}
