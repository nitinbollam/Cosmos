import { randomUUID } from 'node:crypto'
import { Prisma, PurchaseRequisitionStatus } from '@/generated/prisma-purchasing'
import { purchasingDb, tenantDb } from './db'
import { ApiError, type SessionUser } from './session'
import {
  MAX_LINE_QTY,
  MAX_REQUISITION_LINES,
  detailsHash,
  detailsOf,
  normalizeCurrency,
  parseAmount,
  submissionProblem,
} from './requisition-details'
import {
  auditIds,
  closeApprovalRequest,
  deliverRequisitionEvents,
  ensureApprovalRequest,
  faultPoint,
  recordRequisitionEvent,
  syncRequisition,
} from './requisition-approval-sync'

/**
 * Purchase requisitions: a request to buy that a manager signs off on before a PO is created from it.
 *
 * Who may do what (requisitions.read / requisitions.write gate the routes):
 * - Anyone with requisitions.read sees every requisition of their tenant.
 * - Only the requester edits or submits their requisition. Nobody edits or submits on someone else's behalf, so the
 *   person who asked for approval is always the requester, and the self-approval block covers them.
 * - The requester withdraws or cancels their own. TENANT_ADMIN and SUPER_ADMIN may also withdraw or cancel anyone's
 *   (to clear a stuck request when the requester has left). Managers have no override: they are requesters too.
 *
 * Approval is a cross-database protocol: the requisition lives in the purchasing database and its ApprovalRequest in
 * the tenant database. See requisition-approval-sync.ts for which side is the source of truth for what.
 * Converting an approved requisition into a PO is in requisition-conversion.ts.
 */

export const REQUISITION_NUMBER_START = 1000

/** What staff see for a requisition, e.g. PR-1001. */
export function formatRequisitionNumber(n: number): string {
  return `PR-${n}`
}

export const OVERRIDE_ROLES: readonly string[] = ['SUPER_ADMIN', 'TENANT_ADMIN']
const EDITABLE: PurchaseRequisitionStatus[] = [PurchaseRequisitionStatus.DRAFT, PurchaseRequisitionStatus.REJECTED]
const WITHDRAWABLE: PurchaseRequisitionStatus[] = [PurchaseRequisitionStatus.PENDING_APPROVAL, PurchaseRequisitionStatus.APPROVED]
const CANCELLABLE: PurchaseRequisitionStatus[] = [
  PurchaseRequisitionStatus.DRAFT,
  PurchaseRequisitionStatus.PENDING_APPROVAL,
  PurchaseRequisitionStatus.REJECTED,
  PurchaseRequisitionStatus.APPROVED,
]

const withLines = {
  lines: { orderBy: { lineNo: 'asc' as const } },
  supplier: { select: { id: true, code: true, name: true } },
}

/** The caller, always from the authenticated session; never from the request body. */
export type Actor = Pick<SessionUser, 'userId' | 'tenantId' | 'role'>

export type RequisitionLineInput = {
  skuCode?: string | null
  description: string
  qtyRequested: number
  /** A decimal string ("12.50") keeps the exact value; a JSON number is accepted too. */
  unitCost?: string | number | null
}

/** The only fields a client may send. Anything else in the body (tenantId, requestedBy, status...) is ignored. */
export type RequisitionInput = {
  supplierId?: string | null
  currency?: string
  freightAmount?: string | number
  dutyAmount?: string | number
  otherLandedAmount?: string | number
  notes?: string | null
  lines?: RequisitionLineInput[]
}

type ParsedInput = {
  supplierId?: string | null
  currency?: string
  freightAmount?: Prisma.Decimal
  dutyAmount?: Prisma.Decimal
  otherLandedAmount?: Prisma.Decimal
  notes?: string | null
  lines?: Array<{ lineNo: number; skuCode: string | null; description: string; qtyRequested: number; unitCost: Prisma.Decimal | null }>
}

function optionalText(raw: unknown, label: string, max: number): string | null {
  if (raw == null) return null
  if (typeof raw !== 'string') throw new ApiError(400, `${label} must be text`)
  const t = raw.trim()
  if (t.length > max) throw new ApiError(400, `${label} is too long`)
  return t || null
}

/** Validates what a draft may hold. Submission adds its own checks (see submissionProblem). */
export function parseRequisitionInput(body: unknown): ParsedInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Expected a JSON object')
  const b = body as Record<string, unknown>
  const out: ParsedInput = {}
  if (b.supplierId !== undefined) {
    if (b.supplierId !== null && (typeof b.supplierId !== 'string' || !b.supplierId.trim())) {
      throw new ApiError(400, 'supplierId must be a supplier id or null')
    }
    out.supplierId = b.supplierId === null ? null : (b.supplierId as string).trim()
  }
  if (b.currency !== undefined) out.currency = normalizeCurrency(b.currency)
  if (b.freightAmount !== undefined) out.freightAmount = parseAmount(b.freightAmount, 'freightAmount')
  if (b.dutyAmount !== undefined) out.dutyAmount = parseAmount(b.dutyAmount, 'dutyAmount')
  if (b.otherLandedAmount !== undefined) out.otherLandedAmount = parseAmount(b.otherLandedAmount, 'otherLandedAmount')
  if (b.notes !== undefined) out.notes = optionalText(b.notes, 'notes', 2000)
  if (b.lines !== undefined) {
    if (!Array.isArray(b.lines)) throw new ApiError(400, 'lines must be a list')
    if (b.lines.length > MAX_REQUISITION_LINES) throw new ApiError(400, `A requisition can have at most ${MAX_REQUISITION_LINES} lines`)
    // Lines are numbered by the server in the order sent, so there are no duplicate or missing line numbers.
    out.lines = b.lines.map((raw, i) => {
      const lineNo = i + 1
      if (!raw || typeof raw !== 'object') throw new ApiError(400, `Line ${lineNo}: expected an object`)
      const l = raw as Record<string, unknown>
      const description = optionalText(l.description, `Line ${lineNo}: description`, 500)
      if (!description) throw new ApiError(400, `Line ${lineNo}: description is required`)
      const qty = l.qtyRequested
      if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 0 || qty > MAX_LINE_QTY) {
        throw new ApiError(400, `Line ${lineNo}: quantity must be a whole number from 0 to ${MAX_LINE_QTY}`)
      }
      return {
        lineNo,
        skuCode: optionalText(l.skuCode, `Line ${lineNo}: skuCode`, 100),
        description,
        qtyRequested: qty,
        unitCost: l.unitCost == null ? null : parseAmount(l.unitCost, `Line ${lineNo}: unit cost`),
      }
    })
  }
  return out
}

async function assertSupplierInTenant(tx: Prisma.TransactionClient, tenantId: string, supplierId: string) {
  const supplier = await tx.supplier.findFirst({ where: { id: supplierId, tenantId }, select: { id: true } })
  // Same message whether the supplier is missing or belongs to another tenant: ids of other tenants are not revealed.
  if (!supplier) throw new ApiError(400, 'Unknown supplier for tenant')
}

function isOwner(actor: Actor, row: { requestedBy: string }) {
  return row.requestedBy === actor.userId
}

function canOverride(actor: Actor) {
  return OVERRIDE_ROLES.includes(actor.role)
}

async function loadOrThrow(tenantId: string, id: string) {
  const row = await purchasingDb.purchaseRequisition.findFirst({ where: { id, tenantId }, include: withLines })
  if (!row) throw new ApiError(404, 'Requisition not found')
  return row
}

export async function listRequisitions(actor: Actor, filters?: { status?: string; mine?: boolean }) {
  const status = filters?.status
  if (status && !(Object.values(PurchaseRequisitionStatus) as string[]).includes(status)) {
    throw new ApiError(400, 'Unknown requisition status')
  }
  return purchasingDb.purchaseRequisition.findMany({
    where: {
      tenantId: actor.tenantId,
      ...(status ? { status: status as PurchaseRequisitionStatus } : {}),
      ...(filters?.mine ? { requestedBy: actor.userId } : {}),
    },
    include: withLines,
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Reads a requisition, first repairing any approval sync a failed request left behind (lazy recovery). Also returns
 * the linked approval request (read-only, for display) and whether the repair is still outstanding.
 */
export async function getRequisition(actor: Actor, id: string) {
  await loadOrThrow(actor.tenantId, id)
  let syncPending = false
  try {
    await syncRequisition(actor.tenantId, id)
  } catch (err) {
    // The read still answers; the next read or the reconciler retries the repair.
    syncPending = true
    console.error('[requisitions] lazy approval sync failed:', err)
  }
  const row = await loadOrThrow(actor.tenantId, id)
  const approvalRequest = row.approvalRequestId
    ? await tenantDb.approvalRequest.findFirst({
        where: { id: row.approvalRequestId, tenantId: actor.tenantId },
        select: { id: true, status: true, requestedBy: true, decidedBy: true, decidedAt: true, rejectReason: true, cancelReason: true, createdAt: true },
      })
    : null
  // A submitted requisition whose request does not exist yet is waiting on recovery.
  if (row.status === PurchaseRequisitionStatus.PENDING_APPROVAL && !approvalRequest) syncPending = true
  const undelivered = await purchasingDb.purchaseRequisitionEvent.count({ where: { tenantId: actor.tenantId, requisitionId: id, deliveredAt: null } })
  return { ...row, approvalRequest, syncPending: syncPending || undelivered > 0 }
}

export async function createRequisition(actor: Actor, body: unknown) {
  const input = parseRequisitionInput(body)
  const tenantId = actor.tenantId
  return purchasingDb.$transaction(async (tx) => {
    // The counter write comes first: it takes the write lock, so the rest of the transaction runs alone.
    const counter = await tx.purchaseRequisitionCounter.upsert({
      where: { tenantId },
      create: { tenantId, lastNumber: REQUISITION_NUMBER_START + 1 },
      update: { lastNumber: { increment: 1 } },
    })
    if (input.supplierId) await assertSupplierInTenant(tx, tenantId, input.supplierId)
    return tx.purchaseRequisition.create({
      data: {
        tenantId,
        number: formatRequisitionNumber(counter.lastNumber),
        requestedBy: actor.userId,
        status: PurchaseRequisitionStatus.DRAFT,
        supplierId: input.supplierId ?? null,
        currency: input.currency ?? 'USD',
        freightAmount: input.freightAmount ?? new Prisma.Decimal(0),
        dutyAmount: input.dutyAmount ?? new Prisma.Decimal(0),
        otherLandedAmount: input.otherLandedAmount ?? new Prisma.Decimal(0),
        notes: input.notes ?? null,
        lines: { create: input.lines ?? [] },
      },
      include: withLines,
    })
  })
}

/**
 * Runs the tenant-database step that follows a committed purchasing change. The change has happened, so a failure
 * here must not be reported as the action failing (a retry would then hit a 409): it is logged, and lazy recovery
 * or the reconciler finishes it. The detail read reports it as syncPending meanwhile.
 */
async function afterCommit(what: string, step: () => Promise<unknown>) {
  try {
    await step()
  } catch (err) {
    console.error(`[requisitions] ${what} failed after the change was saved; recovery will finish it:`, err)
  }
}

/** Why a guarded edit or submit matched no row, as the error the caller should see. */
async function explainRefusal(tx: Prisma.TransactionClient, actor: Actor, id: string, action: 'edit' | 'submit'): Promise<ApiError> {
  const row = await tx.purchaseRequisition.findFirst({ where: { id, tenantId: actor.tenantId }, select: { status: true, requestedBy: true } })
  if (!row) return new ApiError(404, 'Requisition not found')
  if (!isOwner(actor, row)) return new ApiError(403, `Only the requester can ${action} this requisition`)
  if (!EDITABLE.includes(row.status)) {
    return new ApiError(409, `A ${row.status} requisition cannot be ${action === 'edit' ? 'edited' : 'submitted'}`)
  }
  return new ApiError(409, 'The requisition changed at the same time; reload and try again')
}

/** Edits a DRAFT or REJECTED requisition. The status check and the line replacement are one transaction. */
export async function updateRequisition(actor: Actor, id: string, body: unknown) {
  const input = parseRequisitionInput(body)
  const tenantId = actor.tenantId
  return purchasingDb.$transaction(async (tx) => {
    // Guarded write first: it both checks owner + status and takes the write lock, so a submit cannot slip in between
    // this check and the line changes below.
    const claimed = await tx.purchaseRequisition.updateMany({
      where: { id, tenantId, requestedBy: actor.userId, status: { in: EDITABLE } },
      data: {
        ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.freightAmount !== undefined ? { freightAmount: input.freightAmount } : {}),
        ...(input.dutyAmount !== undefined ? { dutyAmount: input.dutyAmount } : {}),
        ...(input.otherLandedAmount !== undefined ? { otherLandedAmount: input.otherLandedAmount } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedAt: new Date(),
      },
    })
    if (claimed.count !== 1) throw await explainRefusal(tx, actor, id, 'edit')
    if (input.supplierId) await assertSupplierInTenant(tx, tenantId, input.supplierId)
    if (input.lines) {
      await tx.purchaseRequisitionLine.deleteMany({ where: { requisitionId: id } })
      if (input.lines.length) {
        await tx.purchaseRequisitionLine.createMany({ data: input.lines.map((l) => ({ ...l, requisitionId: id })) })
      }
    }
    return tx.purchaseRequisition.findFirstOrThrow({ where: { id, tenantId }, include: withLines })
  })
}

/**
 * Asks for approval of the requisition as it stands. Every submission needs approval, whatever the amount.
 *
 * 1. Purchasing transaction: move DRAFT/REJECTED to PENDING_APPROVAL, bump the revision, and store the hash of the
 *    stored details plus a freshly generated ApprovalRequest id.
 * 2. Tenant transaction: create the ApprovalRequest with that id and its audit event.
 * If step 2 fails the requisition still names the request, so a retried submit, a read, or the reconciler creates
 * it later; the fixed id means it is never created twice.
 */
export async function submitRequisition(actor: Actor, id: string) {
  const tenantId = actor.tenantId
  const approvalRequestId = randomUUID()
  const outcome = await purchasingDb.$transaction(async (tx) => {
    const claimed = await tx.purchaseRequisition.updateMany({
      where: { id, tenantId, requestedBy: actor.userId, status: { in: EDITABLE } },
      data: {
        status: PurchaseRequisitionStatus.PENDING_APPROVAL,
        revision: { increment: 1 },
        approvalRequestId,
        submittedAt: new Date(),
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectReason: null,
      },
    })
    if (claimed.count !== 1) {
      const row = await tx.purchaseRequisition.findFirst({ where: { id, tenantId }, select: { status: true, requestedBy: true } })
      // A retried submit (the first response was lost) finishes the first one instead of failing.
      if (row && isOwner(actor, row) && row.status === PurchaseRequisitionStatus.PENDING_APPROVAL) return 'already-submitted' as const
      throw await explainRefusal(tx, actor, id, 'submit')
    }
    // Read back what is stored: the hash must describe exactly what conversion will later copy.
    const row = await tx.purchaseRequisition.findFirstOrThrow({ where: { id, tenantId }, include: { lines: true } })
    const details = detailsOf(row)
    const problem = submissionProblem(details)
    if (problem) throw new ApiError(400, problem)
    await assertSupplierInTenant(tx, tenantId, row.supplierId as string)
    await tx.purchaseRequisition.updateMany({ where: { id, tenantId }, data: { detailsHash: detailsHash(details) } })
    return 'submitted' as const
  })

  if (outcome === 'submitted') faultPoint('submit:after-purchasing')
  const row = await loadOrThrow(tenantId, id)
  if (row.status === PurchaseRequisitionStatus.PENDING_APPROVAL && row.approvalRequestId) {
    await afterCommit('creating the approval request', () => ensureApprovalRequest(tenantId, row))
  }
  return loadOrThrow(tenantId, id)
}

/**
 * Takes a PENDING_APPROVAL or APPROVED (not yet converted) requisition back to DRAFT for changes. Clearing the approval
 * link is what invalidates the approval (see requisition-approval-sync.ts); closing a pending request in the tenant
 * database follows. Resubmitting asks for a new approval of a new revision.
 */
export async function withdrawRequisition(actor: Actor, id: string) {
  const tenantId = actor.tenantId
  const row = await loadOrThrow(tenantId, id)
  if (!isOwner(actor, row) && !canOverride(actor)) throw new ApiError(403, 'Only the requester can withdraw this requisition')
  if (!WITHDRAWABLE.includes(row.status) || !row.approvalRequestId) {
    throw new ApiError(409, `A ${row.status} requisition cannot be withdrawn`)
  }
  const approvalRequestId = row.approvalRequestId

  await purchasingDb.$transaction(async (tx) => {
    // Conditional: applies only if nothing (a decision copy, a conversion, another withdraw, a cancel) moved the
    // requisition since it was read. The audit event, with the actor, commits with it.
    const res = await tx.purchaseRequisition.updateMany({
      where: { id, tenantId, status: row.status, revision: row.revision, approvalRequestId },
      data: {
        status: PurchaseRequisitionStatus.DRAFT,
        approvalRequestId: null,
        detailsHash: null,
        submittedAt: null,
        approvedBy: null,
        approvedAt: null,
      },
    })
    if (res.count !== 1) throw new ApiError(409, 'The requisition changed at the same time; reload and try again')
    await recordRequisitionEvent(tx, {
      id: auditIds.withdrawn(approvalRequestId),
      tenantId,
      requisitionId: id,
      action: 'requisition.withdrawn',
      userId: actor.userId,
      metadata: { number: row.number, revision: row.revision, previousStatus: row.status, approvalRequestId },
    })
  })

  faultPoint('withdraw:after-purchasing')
  await afterCommit('closing the withdrawn approval request', async () => {
    await closeApprovalRequest(tenantId, approvalRequestId, 'Requisition withdrawn for changes')
    await deliverRequisitionEvents(tenantId, { requisitionId: id })
  })
  return loadOrThrow(tenantId, id)
}

/** Cancels a requisition that has not been converted. Terminal; a pending approval request is closed. */
export async function cancelRequisition(actor: Actor, id: string, reason?: unknown) {
  const tenantId = actor.tenantId
  const cancelReason = optionalText(reason, 'reason', 500) ?? 'Cancelled'
  const row = await loadOrThrow(tenantId, id)
  if (!isOwner(actor, row) && !canOverride(actor)) throw new ApiError(403, 'Only the requester can cancel this requisition')
  if (!CANCELLABLE.includes(row.status)) throw new ApiError(409, `A ${row.status} requisition cannot be cancelled`)

  await purchasingDb.$transaction(async (tx) => {
    const res = await tx.purchaseRequisition.updateMany({
      where: { id, tenantId, status: row.status, revision: row.revision, approvalRequestId: row.approvalRequestId },
      data: { status: PurchaseRequisitionStatus.CANCELLED, cancelledBy: actor.userId, cancelledAt: new Date(), cancelReason },
    })
    if (res.count !== 1) throw new ApiError(409, 'The requisition changed at the same time; reload and try again')
    await recordRequisitionEvent(tx, {
      id: auditIds.cancelled(id),
      tenantId,
      requisitionId: id,
      action: 'requisition.cancelled',
      userId: actor.userId,
      metadata: { number: row.number, revision: row.revision, previousStatus: row.status, approvalRequestId: row.approvalRequestId, reason: cancelReason },
    })
  })

  faultPoint('cancel:after-purchasing')
  await afterCommit('closing the cancelled approval request', async () => {
    if (row.approvalRequestId) await closeApprovalRequest(tenantId, row.approvalRequestId, `Requisition cancelled: ${cancelReason}`)
    await deliverRequisitionEvents(tenantId, { requisitionId: id })
  })
  return loadOrThrow(tenantId, id)
}
