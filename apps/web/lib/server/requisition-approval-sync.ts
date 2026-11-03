import { ApprovalStatus, ApprovalType, type ApprovalRequest } from '@/generated/prisma-tenant'
import { Prisma, PurchaseRequisitionStatus } from '@/generated/prisma-purchasing'
import { purchasingDb, tenantDb } from './db'
import { auditLog, type AuditInput } from './audit-log'
import { cancelApprovalRequest, createApprovalRequest } from './approvals'
import { ApiError } from './session'
import { detailsHash, detailsOf, requisitionTotal } from './requisition-details'
import { runUnscoped, runWithTenant } from './tenant-scope'

/**
 * Keeps a requisition (purchasing database) and its ApprovalRequest (tenant database) in step. There is no transaction
 * across the two, so every step is a conditional write that can be repeated safely.
 *
 * Source of truth, per question:
 * - Was the request approved or rejected? The ApprovalRequest. A decision commits in the tenant database first, with
 *   its audit event, in one transaction. Only afterwards is it copied onto the requisition (APPROVED / REJECTED); that
 *   copy can lag or fail, and applyRequisitionDecision repeats it.
 * - Which request counts? The requisition's approval link: approvalRequestId + revision + detailsHash, which must match
 *   the request's id and the revision and hash in its context. A request the requisition does not link is not an
 *   approval of anything, whatever its own status says.
 * - Withdrawal invalidates by clearing the link in the purchasing database. From that commit on, no decision copy,
 *   decision pre-check or conversion accepts the old request. Closing the request as CANCELLED in the tenant database
 *   follows and is housekeeping: a decision that commits there after the withdrawal is recorded but never applied.
 *   Cancellation freezes the link (status CANCELLED); conversion freezes it too (status CONVERTED).
 *
 * Order of writes:
 * - submit, withdraw, cancel, convert: purchasing first, then tenant.
 * - decide: tenant first (decision + audit), then the purchasing copy.
 *
 * Audit events:
 * - submitted: written with the ApprovalRequest, in its tenant transaction (fixed id).
 * - approved / rejected: written with the decision, in its tenant transaction.
 * - withdrawn, cancelled, converted (and system recoveries): written to PurchaseRequisitionEvent in the same purchasing
 *   transaction as the change, with the acting user, then delivered to AuditEvent under the same id. A failed delivery
 *   is retried by syncRequisition and the reconciler; a delivery is never doubled.
 */

export type RequisitionFaultPoint =
  | 'submit:after-purchasing'
  | 'withdraw:after-purchasing'
  | 'cancel:after-purchasing'
  | 'decision:before-projection'
  | 'convert:after-purchasing'
  | 'events:before-delivery'

let faultHook: ((point: RequisitionFaultPoint) => void) | null = null

/** Tests only: throw at a point between the two databases' writes, to prove recovery. */
export function setRequisitionFaultForTests(hook: ((point: RequisitionFaultPoint) => void) | null) {
  faultHook = hook
}

export function faultPoint(point: RequisitionFaultPoint) {
  faultHook?.(point)
}

export const auditIds = {
  submitted: (approvalRequestId: string) => `prq-submitted-${approvalRequestId}`,
  withdrawn: (approvalRequestId: string) => `prq-withdrawn-${approvalRequestId}`,
  unbound: (approvalRequestId: string) => `prq-unbound-${approvalRequestId}`,
  cancelled: (requisitionId: string) => `prq-cancelled-${requisitionId}`,
  converted: (requisitionId: string) => `prq-converted-${requisitionId}`,
}

type RequisitionContext = { requisitionId: string; number: string; revision: number; detailsHash: string }

export function contextOf(request: Pick<ApprovalRequest, 'context'>): Partial<RequisitionContext> {
  const c = request.context
  return c && typeof c === 'object' && !Array.isArray(c) ? (c as Partial<RequisitionContext>) : {}
}

export function isUniqueViolation(err: unknown) {
  return err instanceof Error && (err as { code?: string }).code === 'P2002'
}

/** Writes an audit event with a fixed id unless it already exists. */
async function ensureAudit(tenantId: string, input: AuditInput & { id: string }): Promise<boolean> {
  const exists = await tenantDb.auditEvent.findFirst({ where: { id: input.id, tenantId }, select: { id: true } })
  if (exists) return false
  try {
    await auditLog(tenantId, input)
    return true
  } catch (err) {
    if (isUniqueViolation(err)) return false
    throw err
  }
}

export type RequisitionEventInput = {
  id: string
  tenantId: string
  requisitionId: string
  action: string
  userId?: string | null
  metadata?: Record<string, unknown>
}

/** Records an audit event in the purchasing outbox. Call inside the purchasing transaction that makes the change. */
export async function recordRequisitionEvent(tx: Prisma.TransactionClient, e: RequisitionEventInput) {
  await tx.purchaseRequisitionEvent.create({
    data: {
      id: e.id,
      tenantId: e.tenantId,
      requisitionId: e.requisitionId,
      action: e.action,
      userId: e.userId ?? null,
      metadata: (e.metadata ?? {}) as Prisma.InputJsonValue,
    },
  })
}

/**
 * Copies undelivered outbox events to the tenant audit log. Safe to run concurrently and repeatedly. An event that
 * fails is logged, counted and left for the next attempt; it does not stop the others.
 */
export async function deliverRequisitionEvents(
  tenantId: string,
  opts?: { requisitionId?: string; limit?: number },
): Promise<{ written: number; failed: number }> {
  const events = await purchasingDb.purchaseRequisitionEvent.findMany({
    where: { tenantId, deliveredAt: null, ...(opts?.requisitionId ? { requisitionId: opts.requisitionId } : {}) },
    orderBy: { createdAt: 'asc' },
    take: opts?.limit ?? 200,
  })
  let written = 0
  let failed = 0
  for (const e of events) {
    try {
      faultPoint('events:before-delivery')
      const wrote = await ensureAudit(tenantId, {
        id: e.id,
        action: e.action,
        entityType: 'PurchaseRequisition',
        entityId: e.requisitionId,
        userId: e.userId ?? undefined,
        metadata: (e.metadata ?? {}) as Record<string, unknown>,
        createdAt: e.createdAt,
      })
      if (wrote) written++
      await purchasingDb.purchaseRequisitionEvent.updateMany({ where: { id: e.id, tenantId, deliveredAt: null }, data: { deliveredAt: new Date() } })
    } catch (err) {
      failed++
      console.error(`[requisitions] audit delivery of ${e.id} failed; it will be retried:`, err)
    }
  }
  return { written, failed }
}

type PendingRow = Prisma.PurchaseRequisitionGetPayload<{ include: { lines: true; supplier: { select: { name: true } } } }>

/**
 * Creates the ApprovalRequest a submitted requisition names, with its "submitted" audit event, if it does not exist
 * yet. Then checks the requisition still names it: if a withdraw or cancel ran meanwhile, the new request is closed.
 * Returns true when this call created the request.
 */
export async function ensureApprovalRequest(tenantId: string, row: PendingRow): Promise<boolean> {
  const id = row.approvalRequestId
  if (row.status !== PurchaseRequisitionStatus.PENDING_APPROVAL || !id || !row.detailsHash) return false
  let created = false
  const existing = await tenantDb.approvalRequest.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!existing) {
    const total = requisitionTotal(row)
    try {
      await tenantDb.$transaction(async (tx) => {
        await createApprovalRequest(
          tenantId,
          {
            id,
            type: ApprovalType.PURCHASE_REQUISITION,
            subjectId: row.id,
            requestedBy: row.requestedBy,
            context: {
              requisitionId: row.id,
              number: row.number,
              revision: row.revision,
              detailsHash: row.detailsHash,
              total,
              currency: row.currency,
              supplierId: row.supplierId,
              supplierName: row.supplier?.name ?? null,
              lineCount: row.lines.length,
            },
          },
          tx,
        )
        await auditLog(
          tenantId,
          {
            id: auditIds.submitted(id),
            action: 'requisition.submitted',
            entityType: 'PurchaseRequisition',
            entityId: row.id,
            userId: row.requestedBy,
            metadata: { number: row.number, revision: row.revision, approvalRequestId: id, detailsHash: row.detailsHash, total, currency: row.currency },
          },
          tx,
        )
      })
      created = true
    } catch (err) {
      // Another repair created it first; theirs is the same request.
      if (!isUniqueViolation(err)) throw err
    }
  }
  await closeIfStale(tenantId, id, row.id)
  return created
}

/** Closes a pending request (never a decided one). The audit event for the change comes from the outbox. */
export async function closeApprovalRequest(tenantId: string, approvalRequestId: string, cancelReason: string): Promise<boolean> {
  return cancelApprovalRequest(tenantId, approvalRequestId, { cancelReason })
}

function isActiveLink(
  row: { status: PurchaseRequisitionStatus; approvalRequestId: string | null; revision: number; detailsHash: string | null } | null,
  request: Pick<ApprovalRequest, 'id' | 'context'>,
  status: PurchaseRequisitionStatus,
) {
  const ctx = contextOf(request)
  return Boolean(
    row && row.status === status && row.approvalRequestId === request.id && row.revision === ctx.revision && row.detailsHash === ctx.detailsHash,
  )
}

/** Closes the request when it is pending but no longer the one the requisition is waiting on. */
async function closeIfStale(tenantId: string, approvalRequestId: string, requisitionId: string): Promise<boolean> {
  const request = await tenantDb.approvalRequest.findFirst({ where: { id: approvalRequestId, tenantId } })
  if (!request || request.status !== ApprovalStatus.PENDING) return false
  const row = await purchasingDb.purchaseRequisition.findFirst({ where: { id: requisitionId, tenantId } })
  if (isActiveLink(row, request, PurchaseRequisitionStatus.PENDING_APPROVAL)) return false
  const cancelled = row?.status === PurchaseRequisitionStatus.CANCELLED && row.approvalRequestId === approvalRequestId
  const closed = await closeApprovalRequest(
    tenantId,
    approvalRequestId,
    cancelled ? `Requisition cancelled: ${row?.cancelReason ?? 'Cancelled'}` : 'Requisition withdrawn for changes',
  )
  // The withdraw / cancel that made it stale may not have delivered its audit event either.
  await deliverRequisitionEvents(tenantId, { requisitionId })
  return closed
}

/**
 * Before an approver decides a requisition's request: refuses (409) unless it is the active request and the stored
 * details still hash to what was submitted. A stale request is closed on the way.
 */
export async function assertRequisitionApprovalDecidable(tenantId: string, request: ApprovalRequest) {
  // Already decided or closed: the decision itself refuses it, with the usual message.
  if (request.status !== ApprovalStatus.PENDING) return
  const row = await purchasingDb.purchaseRequisition.findFirst({ where: { id: request.subjectId, tenantId }, include: { lines: true } })
  if (!row || !isActiveLink(row, request, PurchaseRequisitionStatus.PENDING_APPROVAL)) {
    await closeIfStale(tenantId, request.id, request.subjectId)
    throw new ApiError(409, 'This requisition was withdrawn, changed or cancelled after approval was requested; the request is closed')
  }
  if (detailsHash(detailsOf(row)) !== row.detailsHash) {
    throw new ApiError(409, 'The requisition no longer matches what was submitted for approval')
  }
}

export type ProjectionResult = 'applied' | 'already-applied' | 'stale'

/**
 * Copies a decided request's outcome onto its requisition, if the requisition still links that request at that
 * revision and hash. Runs after the decision has committed in the tenant database.
 */
export async function applyRequisitionDecision(tenantId: string, request: ApprovalRequest): Promise<ProjectionResult> {
  if (request.type !== ApprovalType.PURCHASE_REQUISITION) return 'stale'
  if (request.status !== ApprovalStatus.APPROVED && request.status !== ApprovalStatus.REJECTED) return 'stale'
  faultPoint('decision:before-projection')
  const approved = request.status === ApprovalStatus.APPROVED
  const ctx = contextOf(request)
  if (typeof ctx.revision !== 'number' || typeof ctx.detailsHash !== 'string') return 'stale'
  const decidedAt = request.decidedAt ?? new Date()
  const res = await purchasingDb.purchaseRequisition.updateMany({
    where: {
      id: request.subjectId,
      tenantId,
      status: PurchaseRequisitionStatus.PENDING_APPROVAL,
      approvalRequestId: request.id,
      revision: ctx.revision,
      detailsHash: ctx.detailsHash,
    },
    data: approved
      ? { status: PurchaseRequisitionStatus.APPROVED, approvedBy: request.decidedBy, approvedAt: decidedAt }
      : { status: PurchaseRequisitionStatus.REJECTED, rejectedBy: request.decidedBy, rejectedAt: decidedAt, rejectReason: request.rejectReason },
  })
  if (res.count === 1) return 'applied'
  const row = await purchasingDb.purchaseRequisition.findFirst({
    where: { id: request.subjectId, tenantId },
    select: { status: true, approvalRequestId: true },
  })
  const target = approved ? PurchaseRequisitionStatus.APPROVED : PurchaseRequisitionStatus.REJECTED
  const after: PurchaseRequisitionStatus[] = approved ? [target, PurchaseRequisitionStatus.CONVERTED] : [target]
  return row?.approvalRequestId === request.id && after.includes(row.status) ? 'already-applied' : 'stale'
}

export type SyncOutcome = 'request-created' | 'decision-applied' | 'stale-closed' | 'audit-written' | 'unbound'

/**
 * Lazy recovery for one requisition: finishes whatever a failed submit, decision, withdraw, cancel or conversion left
 * half done. Safe to call any number of times, concurrently with the user actions themselves.
 */
export async function syncRequisition(tenantId: string, requisitionId: string): Promise<SyncOutcome[]> {
  const out: SyncOutcome[] = []
  const row = await purchasingDb.purchaseRequisition.findFirst({
    where: { id: requisitionId, tenantId },
    include: { lines: true, supplier: { select: { name: true } } },
  })
  if (!row) return out

  if (row.status === PurchaseRequisitionStatus.PENDING_APPROVAL && row.approvalRequestId) {
    const request = await tenantDb.approvalRequest.findFirst({ where: { id: row.approvalRequestId, tenantId } })
    if (!request) {
      if (await ensureApprovalRequest(tenantId, row)) out.push('request-created')
    } else if (request.status === ApprovalStatus.APPROVED || request.status === ApprovalStatus.REJECTED) {
      if ((await applyRequisitionDecision(tenantId, request)) === 'applied') out.push('decision-applied')
    } else if (request.status === ApprovalStatus.CANCELLED) {
      // The request was closed (e.g. by an admin) while the requisition still waits on it: nothing can approve it now,
      // so hand it back to the requester as a draft, and say so in the audit log.
      const id = row.approvalRequestId
      const unbound = await purchasingDb.$transaction(async (tx) => {
        const res = await tx.purchaseRequisition.updateMany({
          where: { id: row.id, tenantId, status: PurchaseRequisitionStatus.PENDING_APPROVAL, approvalRequestId: id },
          data: { status: PurchaseRequisitionStatus.DRAFT, approvalRequestId: null, detailsHash: null, submittedAt: null },
        })
        if (res.count !== 1) return false
        await recordRequisitionEvent(tx, {
          id: auditIds.unbound(id),
          tenantId,
          requisitionId: row.id,
          action: 'requisition.returned_to_draft',
          userId: null,
          metadata: { number: row.number, revision: row.revision, approvalRequestId: id, reason: 'Approval request was closed without a decision' },
        })
        return true
      })
      if (unbound) out.push('unbound')
    }
  }

  if (row.status === PurchaseRequisitionStatus.CANCELLED && row.approvalRequestId) {
    if (await closeIfStale(tenantId, row.approvalRequestId, row.id)) out.push('stale-closed')
  }
  if ((await deliverRequisitionEvents(tenantId, { requisitionId: row.id })).written > 0) out.push('audit-written')
  return out
}

export type ReconcileReport = {
  requisitionsChecked: number
  requestsChecked: number
  requestsCreated: number
  decisionsApplied: number
  staleClosed: number
  auditsWritten: number
  unbound: number
  errors: number
  /** True when the per-run budget ran out; the next run continues where this one stopped. */
  more: boolean
}

type Cursor = { id: string } | undefined
/** Where an all-tenant run stopped when its budget ran out, so the next run continues instead of starting over. */
const resume: { requisitions: Cursor; requests: Cursor } = { requisitions: undefined, requests: undefined }

/** Tests only: start the next all-tenant sweep from the beginning. */
export function resetRequisitionReconcileCursorForTests() {
  resume.requisitions = undefined
  resume.requests = undefined
}

/**
 * The sweep behind lazy recovery, for requisitions nobody reads: requisitions still pending approval, recently
 * cancelled ones, every pending requisition request, and every undelivered audit event.
 *
 * Bounded: each category is walked by id in batches of `batchSize`, at most `maxBatches` per run. An all-tenant run
 * that runs out of budget remembers where it stopped and the next run continues from there, so healthy rows at the
 * front can never starve the rest. Every repair is a conditional write and runs inside its own tenant's scope, so a
 * run can overlap user actions, lazy recovery, or (after a crash) another run.
 */
export async function reconcileRequisitionApprovals(opts?: {
  tenantId?: string
  batchSize?: number
  maxBatches?: number
  cancelledSince?: Date
}): Promise<ReconcileReport> {
  const batchSize = opts?.batchSize ?? 200
  const maxBatches = opts?.maxBatches ?? 10
  const since = opts?.cancelledSince ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const tenantFilter = opts?.tenantId ? { tenantId: opts.tenantId } : {}
  const scoped = <T>(fn: () => Promise<T>) =>
    opts?.tenantId ? runWithTenant(opts.tenantId, fn) : runUnscoped('requisition approval reconciler: sweep across tenants', fn)
  const report: ReconcileReport = {
    requisitionsChecked: 0,
    requestsChecked: 0,
    requestsCreated: 0,
    decisionsApplied: 0,
    staleClosed: 0,
    auditsWritten: 0,
    unbound: 0,
    errors: 0,
    more: false,
  }

  // Walks one category by id. Returns the cursor to resume from, or undefined when it reached the end.
  async function walk<T extends { id: string }>(start: Cursor, page: (after: Cursor) => Promise<T[]>, each: (row: T) => Promise<void>) {
    let cursor = start
    for (let batch = 0; batch < maxBatches; batch++) {
      const rows = await scoped(() => page(cursor))
      for (const row of rows) await each(row)
      if (rows.length < batchSize) return undefined
      cursor = { id: rows[rows.length - 1].id }
    }
    report.more = true
    return cursor
  }
  const allTenants = !opts?.tenantId

  const nextRequisitions = await walk(
    allTenants ? resume.requisitions : undefined,
    (after) =>
      purchasingDb.purchaseRequisition.findMany({
        where: {
          ...tenantFilter,
          ...(after ? { id: { gt: after.id } } : {}),
          OR: [
            { status: PurchaseRequisitionStatus.PENDING_APPROVAL },
            { status: PurchaseRequisitionStatus.CANCELLED, updatedAt: { gte: since } },
          ],
        },
        select: { id: true, tenantId: true },
        orderBy: { id: 'asc' },
        take: batchSize,
      }),
    async (r) => {
      report.requisitionsChecked++
      try {
        const outcomes = await runWithTenant(r.tenantId, () => syncRequisition(r.tenantId, r.id))
        for (const o of outcomes) {
          if (o === 'request-created') report.requestsCreated++
          if (o === 'decision-applied') report.decisionsApplied++
          if (o === 'stale-closed') report.staleClosed++
          if (o === 'audit-written') report.auditsWritten++
          if (o === 'unbound') report.unbound++
        }
      } catch (err) {
        report.errors++
        console.error(`[requisitions] reconcile of requisition ${r.id} failed:`, err)
      }
    },
  )
  const nextRequests = await walk(
    allTenants ? resume.requests : undefined,
    (after) =>
      tenantDb.approvalRequest.findMany({
        where: { ...tenantFilter, ...(after ? { id: { gt: after.id } } : {}), type: ApprovalType.PURCHASE_REQUISITION, status: ApprovalStatus.PENDING },
        select: { id: true, tenantId: true, subjectId: true },
        orderBy: { id: 'asc' },
        take: batchSize,
      }),
    async (q) => {
      report.requestsChecked++
      try {
        if (await runWithTenant(q.tenantId, () => closeIfStale(q.tenantId, q.id, q.subjectId))) report.staleClosed++
      } catch (err) {
        report.errors++
        console.error(`[requisitions] reconcile of approval request ${q.id} failed:`, err)
      }
    },
  )
  if (allTenants) {
    resume.requisitions = nextRequisitions
    resume.requests = nextRequests
  }

  // Audit events leave the queue once delivered, so oldest-first batches always make progress; an event that keeps
  // failing is counted and skipped, not allowed to block the rest of its tenant.
  const eventTenants = await scoped(() =>
    purchasingDb.purchaseRequisitionEvent.findMany({ where: { ...tenantFilter, deliveredAt: null }, distinct: ['tenantId'], select: { tenantId: true } }),
  )
  for (const { tenantId } of eventTenants) {
    try {
      const res = await runWithTenant(tenantId, () => deliverRequisitionEvents(tenantId, { limit: batchSize * maxBatches }))
      report.auditsWritten += res.written
      report.errors += res.failed
    } catch (err) {
      report.errors++
      console.error(`[requisitions] audit delivery for tenant ${tenantId} failed:`, err)
    }
  }
  return report
}

/** Requisition reconcile runs started but not finished in this process (the scheduler skips while one is running). */
let jobRunning = false

/**
 * The scheduled entry point (see background-jobs.ts). Skips when REQUISITION_RECONCILE_DISABLED=1 or when the previous
 * run has not finished. Returns the report, or null when skipped.
 */
export async function runRequisitionReconcileJob(): Promise<ReconcileReport | null> {
  if (process.env.REQUISITION_RECONCILE_DISABLED === '1' || jobRunning) return null
  jobRunning = true
  try {
    const r = await reconcileRequisitionApprovals()
    const changed = r.requestsCreated + r.decisionsApplied + r.staleClosed + r.auditsWritten + r.unbound
    if (changed > 0 || r.errors > 0) {
      console.log(
        `[jobs] requisitions: created ${r.requestsCreated} request(s), applied ${r.decisionsApplied} decision(s), closed ${r.staleClosed}, ` +
          `returned ${r.unbound} to draft, delivered ${r.auditsWritten} audit event(s), ${r.errors} error(s)${r.more ? '; more next run' : ''}`,
      )
    }
    return r
  } finally {
    jobRunning = false
  }
}
