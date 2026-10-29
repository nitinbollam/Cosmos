import { lineAmount, sumAmounts } from '@/lib/decimal-amount'

/**
 * Purchase requisitions in the admin UI. The rules here mirror the server (purchase-requisitions.ts, routes/approvals.ts)
 * so people only see actions that will work; the server still enforces every one of them.
 */

export type RequisitionStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CONVERTED' | 'CANCELLED'

export const REQUISITION_STATUSES: RequisitionStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED']

export type RequisitionLine = {
  id?: string
  lineNo: number
  skuCode: string | null
  description: string
  qtyRequested: number
  /** Decimal string from the API, or null on a draft line without a price. */
  unitCost: string | null
}

export type Requisition = {
  id: string
  number: string
  status: RequisitionStatus
  requestedBy: string
  supplierId: string | null
  supplier?: { id: string; code: string; name: string } | null
  currency: string
  freightAmount: string
  dutyAmount: string
  otherLandedAmount: string
  notes: string | null
  revision: number
  approvalRequestId: string | null
  submittedAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  rejectedBy: string | null
  rejectedAt: string | null
  rejectReason: string | null
  cancelledBy: string | null
  cancelledAt: string | null
  cancelReason: string | null
  purchaseOrderId: string | null
  createdAt: string
  updatedAt: string
  lines: RequisitionLine[]
  /** Only on the detail read. */
  approvalRequest?: {
    id: string
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
    requestedBy: string
    decidedBy: string | null
    decidedAt: string | null
    rejectReason: string | null
    cancelReason: string | null
  } | null
  /** Only on the detail read: an approval sync or audit delivery is still being retried. */
  syncPending?: boolean
}

export type Viewer = { userId?: string; role?: string; permissions?: string[] }

/** The approver gate on /approvals/:id/decide is by role. */
export const APPROVER_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER']
/** May withdraw or cancel someone else's requisition. */
export const OVERRIDE_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN']

/** Same matching as the server's hasPermission: admins, '*', exact, or `<module>.*`. */
export function hasClientPermission(viewer: Viewer | undefined, required: string): boolean {
  if (!viewer) return false
  if (viewer.role === 'SUPER_ADMIN' || viewer.role === 'TENANT_ADMIN') return true
  const perms = viewer.permissions ?? []
  if (perms.includes('*') || perms.includes(required)) return true
  const [mod] = required.split('.')
  return perms.includes(`${mod}.*`)
}

export type RequisitionActions = {
  edit: boolean
  submit: boolean
  withdraw: boolean
  cancel: boolean
  convert: boolean
  openPo: boolean
  /** Approve is offered; reject is offered whenever approve is. */
  decide: boolean
  /** Why the viewer, an approver, cannot decide this one (their own requisition). */
  decideBlockedReason: string | null
}

export function requisitionActions(r: Requisition, viewer: Viewer | undefined): RequisitionActions {
  const write = hasClientPermission(viewer, 'requisitions.write')
  const mine = !!viewer?.userId && viewer.userId === r.requestedBy
  const override = OVERRIDE_ROLES.includes(viewer?.role ?? '')
  const editable = r.status === 'DRAFT' || r.status === 'REJECTED'
  const approver = APPROVER_ROLES.includes(viewer?.role ?? '')
  const pendingRequest =
    r.status === 'PENDING_APPROVAL' && !!r.approvalRequestId && (r.approvalRequest == null || r.approvalRequest.status === 'PENDING')
  return {
    edit: write && mine && editable,
    submit: write && mine && editable,
    withdraw: write && (mine || override) && (r.status === 'PENDING_APPROVAL' || r.status === 'APPROVED'),
    cancel: write && (mine || override) && ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED'].includes(r.status),
    convert: r.status === 'APPROVED' && hasClientPermission(viewer, 'purchasing.write'),
    openPo: r.status === 'CONVERTED' && !!r.purchaseOrderId,
    decide: approver && !mine && pendingRequest && !!r.approvalRequest,
    decideBlockedReason: approver && mine && pendingRequest ? 'You raised this requisition, so another manager or admin approves it.' : null,
  }
}

/** Lines plus landed estimates, exact. Unpriced draft lines count as 0. */
export function requisitionTotals(r: Pick<Requisition, 'lines' | 'freightAmount' | 'dutyAmount' | 'otherLandedAmount'>) {
  const lines = sumAmounts(r.lines.map((l) => (l.unitCost == null ? '0' : lineAmount(l.unitCost, l.qtyRequested))))
  const landed = sumAmounts([r.freightAmount, r.dutyAmount, r.otherLandedAmount])
  return { lines, landed, total: sumAmounts([lines, landed]), unpriced: r.lines.filter((l) => l.unitCost == null).length }
}

/** What still blocks submitting, in the server's words, or [] when it can be submitted. */
export function submissionProblems(r: Pick<Requisition, 'supplierId' | 'lines'>): string[] {
  const out: string[] = []
  if (!r.supplierId) out.push('Choose a supplier')
  if (r.lines.length === 0) out.push('Add at least one line')
  for (const l of r.lines) {
    if (l.qtyRequested <= 0) out.push(`Line ${l.lineNo}: quantity must be more than 0`)
    if (l.unitCost == null) out.push(`Line ${l.lineNo}: enter a unit cost (0 is allowed)`)
  }
  return out
}

export const STATUS_HELP: Record<RequisitionStatus, string> = {
  DRAFT: 'Not yet sent for approval. The requester can edit and submit it.',
  PENDING_APPROVAL: 'Waiting for a manager or admin other than the requester to approve it.',
  APPROVED: 'Approved. Someone with purchasing rights can convert it to a purchase order.',
  REJECTED: 'Rejected. The requester can revise it and submit again for a fresh approval.',
  CONVERTED: 'A purchase order was created from this requisition.',
  CANCELLED: 'Cancelled. Nothing more can be done with it.',
}

/** The message and HTTP status of a failed API call (axios-shaped errors). */
export function apiFailure(e: unknown): { status: number | null; message: string } {
  const res = e && typeof e === 'object' && 'response' in e ? (e as { response?: { status?: number; data?: { message?: unknown } } }).response : undefined
  const m = res?.data?.message
  const message = Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : e instanceof Error ? e.message : 'Request failed'
  return { status: res?.status ?? null, message }
}
