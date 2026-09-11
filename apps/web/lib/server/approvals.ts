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

export async function decideApprovalRequest(
  tenantId: string,
  id: string,
  decision: { approve: boolean; decidedBy: string; rejectReason?: string },
) {
  const row = await getApprovalRequest(tenantId, id)
  if (row.status !== ApprovalStatus.PENDING) {
    throw new ApiError(400, 'Approval request is already decided')
  }

  const updated = await tenantDb.approvalRequest.update({
    where: { id },
    data: {
      status: decision.approve ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
      decidedBy: decision.decidedBy,
      decidedAt: new Date(),
      rejectReason: decision.approve ? null : decision.rejectReason?.trim() || 'Rejected',
    },
  })

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
