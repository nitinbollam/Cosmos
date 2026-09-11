import type { ApprovalStatus, ApprovalType } from '@/generated/prisma-tenant'
import * as approvals from '../approvals'
import { ApiError, requirePermission, requireSession, assertRole } from './common'

const APPROVER_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER'] as const

export async function routeApprovals(method: string, seg: string[], req: Request): Promise<Response> {
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    const session = await requirePermission(req, 'approvals.read')
    const type = url.searchParams.get('type') as ApprovalType | null
    const status = url.searchParams.get('status') as ApprovalStatus | null
    return Response.json(
      await approvals.listApprovalRequests(session.tenantId, {
        type: type ?? undefined,
        status: status ?? undefined,
      }),
    )
  }

  if (seg.length === 2 && method === 'GET') {
    const session = await requirePermission(req, 'approvals.read')
    return Response.json(await approvals.getApprovalRequest(session.tenantId, seg[1]))
  }

  if (seg.length === 3 && seg[2] === 'decide' && method === 'POST') {
    const session = await requireSession(req)
    assertRole(session, APPROVER_ROLES)
    const body = (await req.json()) as { approve: boolean; rejectReason?: string }
    if (!body.approve && !body.rejectReason?.trim()) {
      throw new ApiError(400, 'rejectReason is required when rejecting')
    }
    const updated = await approvals.decideApprovalRequest(session.tenantId, seg[1], {
      approve: body.approve,
      decidedBy: session.userId,
      rejectReason: body.rejectReason,
    })
    const { onApprovalDecided } = await import('../approval-hooks')
    await onApprovalDecided(session.tenantId, updated)
    return Response.json(updated)
  }

  throw new ApiError(404, 'Approval route not found')
}
