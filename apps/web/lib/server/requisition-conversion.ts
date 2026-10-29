import { ApprovalStatus, ApprovalType, type ApprovalRequest } from '@/generated/prisma-tenant'
import { Prisma, PurchaseOrderStatus, PurchaseRequisitionStatus } from '@/generated/prisma-purchasing'
import { purchasingDb, tenantDb } from './db'
import { ApiError } from './session'
import type { Actor } from './purchase-requisitions'
import { canonicalDecimal, detailsHash, detailsOf, parseAmount, requisitionTotal, submissionProblem } from './requisition-details'
import {
  auditIds,
  contextOf,
  deliverRequisitionEvents,
  faultPoint,
  isUniqueViolation,
  recordRequisitionEvent,
} from './requisition-approval-sync'

/**
 * Approved requisition -> purchase order.
 *
 * Conversion needs both sources of truth to agree (see requisition-approval-sync.ts): the requisition is APPROVED and
 * links an ApprovalRequest that is APPROVED, for the same tenant, subject, type, revision and details hash, decided by
 * someone other than the requester. The PO is built only from what is stored on the requisition; the caller may choose
 * the PO number and nothing else.
 *
 * One purchasing transaction claims the approved revision (APPROVED -> CONVERTED, conditional on the link), re-reads
 * and re-checks the details, creates the PO and its lines, stores both links (requisition.purchaseOrderId and
 * PO.requisitionId) and records the conversion audit event in the outbox. Any failure, a PO number collision included,
 * rolls all of it back. A retry after success returns the same PO.
 *
 * After conversion the PO starts DRAFT. Its lines, supplier and currency are fixed by the approval. Landed costs
 * (freight, duty, other) may still change, but their sum may not exceed the approved landed sum, so the PO total never
 * exceeds the approved total. The requisition's hash keeps describing exactly what was approved; it is not recomputed
 * over the PO. Submitting the PO checks the PO against the hash-verified approved details (equal lines, supplier and
 * currency; landed within the cap) and then skips the PO threshold approval, because the requisition approval covers it.
 */

const PO_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/

const withLines = {
  lines: { orderBy: { lineNo: 'asc' as const } },
  supplier: true,
}

/** The default PO number for a requisition: deterministic, so a retry cannot mint a second one. */
export function defaultPoNumber(requisitionNumber: string) {
  return `PO-${requisitionNumber}`
}

function parseConvertBody(body: unknown): { number?: string } {
  if (body == null) return {}
  if (typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Expected a JSON object')
  const extra = Object.keys(body).filter((k) => k !== 'number')
  if (extra.length) {
    throw new ApiError(400, `Only a PO number may be sent; supplier, currency, lines and costs come from the approved requisition (got ${extra.join(', ')})`)
  }
  const raw = (body as { number?: unknown }).number
  if (raw == null) return {}
  if (typeof raw !== 'string' || !PO_NUMBER.test(raw.trim())) {
    throw new ApiError(400, 'number must be 1-64 letters, digits or . _ - /, starting with a letter or digit')
  }
  return { number: raw.trim() }
}

type RequisitionWithLines = Prisma.PurchaseRequisitionGetPayload<{ include: { lines: true } }>

/**
 * The approval behind a requisition, checked against the authoritative ApprovalRequest. Throws 409 naming the first
 * inconsistency. Does not look at the requisition's own status; callers check that.
 */
export async function verifyApprovedSource(tenantId: string, row: RequisitionWithLines): Promise<ApprovalRequest> {
  const refuse = (why: string) => new ApiError(409, `The requisition's approval is not valid: ${why}`)
  if (row.tenantId !== tenantId) throw refuse('it belongs to another tenant')
  if (!row.approvalRequestId || !row.detailsHash) throw refuse('it has no active approval')
  const request = await tenantDb.approvalRequest.findFirst({ where: { id: row.approvalRequestId, tenantId } })
  if (!request || request.tenantId !== tenantId) throw refuse('its approval request was not found')
  if (request.type !== ApprovalType.PURCHASE_REQUISITION || request.subjectId !== row.id) {
    throw refuse('its approval request is for something else')
  }
  if (request.status !== ApprovalStatus.APPROVED) throw refuse(`its approval request is ${request.status}`)
  const ctx = contextOf(request)
  if (ctx.revision !== row.revision || ctx.detailsHash !== row.detailsHash) {
    throw refuse('it was approved for a different revision')
  }
  if (!request.decidedBy || request.decidedBy === request.requestedBy || request.decidedBy === row.requestedBy) {
    throw refuse('it was approved by its own requester')
  }
  if (request.requestedBy !== row.requestedBy || row.approvedBy !== request.decidedBy) {
    throw refuse('the requisition and its approval request disagree')
  }
  if (detailsHash(detailsOf(row)) !== row.detailsHash) {
    throw refuse('its purchasing details no longer match what was approved')
  }
  return request
}

async function existingConversion(tenantId: string, row: { id: string; purchaseOrderId: string | null }, requestedNumber?: string) {
  const inconsistent = new ApiError(409, 'This requisition is marked converted but its purchase order link is inconsistent')
  if (!row.purchaseOrderId) throw inconsistent
  const po = await purchasingDb.purchaseOrder.findFirst({ where: { id: row.purchaseOrderId, tenantId }, include: withLines })
  if (!po || po.tenantId !== tenantId || po.requisitionId !== row.id) throw inconsistent
  if (requestedNumber && requestedNumber !== po.number) {
    throw new ApiError(409, `This requisition was already converted to ${po.number}`)
  }
  return po
}

export type ConversionResult = {
  purchaseOrder: Prisma.PurchaseOrderGetPayload<{ include: typeof withLines }>
  /** False when an earlier (or concurrent) call made this PO and this call returned it. */
  created: boolean
}

export async function convertRequisition(actor: Actor, id: string, body: unknown): Promise<ConversionResult> {
  const tenantId = actor.tenantId
  const { number } = parseConvertBody(body)
  const row = await purchasingDb.purchaseRequisition.findFirst({ where: { id, tenantId }, include: { lines: true } })
  if (!row) throw new ApiError(404, 'Requisition not found')

  if (row.status === PurchaseRequisitionStatus.CONVERTED) return finishRetry(tenantId, row, number)
  if (row.status !== PurchaseRequisitionStatus.APPROVED) {
    throw new ApiError(409, `A ${row.status} requisition cannot be converted; it must be approved first`)
  }
  const approval = await verifyApprovedSource(tenantId, row)
  const { resolveFxRateAtCreation } = await import('./exchange-rates')
  // Throws (400) when the tenant has no rate for the currency: never a silent 1.0.
  const fx = await resolveFxRateAtCreation(tenantId, row.currency)
  const poNumber = number ?? defaultPoNumber(row.number)

  let outcome: { po: ConversionResult['purchaseOrder'] } | 'lost'
  try {
    outcome = await purchasingDb.$transaction(async (tx) => {
      // The claim comes first: it takes the write lock and succeeds for exactly one caller, and only while the
      // requisition still links this approval at this revision and hash.
      const claimed = await tx.purchaseRequisition.updateMany({
        where: {
          id,
          tenantId,
          status: PurchaseRequisitionStatus.APPROVED,
          approvalRequestId: approval.id,
          revision: row.revision,
          detailsHash: row.detailsHash,
          purchaseOrderId: null,
        },
        data: { status: PurchaseRequisitionStatus.CONVERTED },
      })
      if (claimed.count !== 1) return 'lost' as const

      // Re-read inside the transaction: the PO is built from these rows, not from anything read earlier.
      const fresh = await tx.purchaseRequisition.findFirstOrThrow({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } })
      const details = detailsOf(fresh)
      if (detailsHash(details) !== row.detailsHash) {
        throw new ApiError(409, "The requisition's approval is not valid: its purchasing details no longer match what was approved")
      }
      const problem = submissionProblem(details)
      if (problem) throw new ApiError(409, `The approved requisition cannot become a PO: ${problem}`)
      const supplier = await tx.supplier.findFirst({ where: { id: fresh.supplierId as string, tenantId }, select: { id: true } })
      if (!supplier) throw new ApiError(409, "The requisition's supplier is not a supplier of this tenant")

      const po = await tx.purchaseOrder.create({
        data: {
          tenantId,
          supplierId: supplier.id,
          number: poNumber,
          status: PurchaseOrderStatus.DRAFT,
          notes: [`From requisition ${fresh.number}`, fresh.notes].filter(Boolean).join('\n'),
          freightAmount: fresh.freightAmount,
          dutyAmount: fresh.dutyAmount,
          otherLandedAmount: fresh.otherLandedAmount,
          currency: fresh.currency,
          fxRateToBase: new Prisma.Decimal(String(fx.fxRateToBase)), // money-ok: the rate comes back as a number from resolveFxRateAtCreation, stored as bills and invoices do
          createdBy: actor.userId,
          requisitionId: fresh.id,
          lines: {
            create: fresh.lines.map((l) => ({
              lineNo: l.lineNo,
              skuCode: l.skuCode,
              description: l.description,
              qtyOrdered: l.qtyRequested,
              unitCost: l.unitCost,
            })),
          },
        },
        include: withLines,
      })
      const linked = await tx.purchaseRequisition.updateMany({
        where: { id, tenantId, status: PurchaseRequisitionStatus.CONVERTED, purchaseOrderId: null },
        data: { purchaseOrderId: po.id },
      })
      if (linked.count !== 1) throw new ApiError(409, 'The requisition changed during conversion; nothing was created')
      await recordRequisitionEvent(tx, {
        id: auditIds.converted(id),
        tenantId,
        requisitionId: id,
        action: 'requisition.converted',
        userId: actor.userId,
        metadata: {
          number: fresh.number,
          revision: fresh.revision,
          detailsHash: fresh.detailsHash,
          approvalRequestId: approval.id,
          approvedBy: approval.decidedBy,
          purchaseOrderId: po.id,
          purchaseOrderNumber: po.number,
          approvedTotal: requisitionTotal(details),
          currency: fresh.currency,
        },
      })
      return { po }
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, `PO number ${poNumber} is already in use; nothing was converted`)
    throw err
  }

  if (outcome === 'lost') {
    // Someone else moved it first. If they converted it, this is the same conversion: return their PO.
    const now = await purchasingDb.purchaseRequisition.findFirst({ where: { id, tenantId } })
    if (now?.status === PurchaseRequisitionStatus.CONVERTED) return finishRetry(tenantId, now, number)
    throw new ApiError(409, `The requisition changed at the same time (now ${now?.status ?? 'missing'}); nothing was converted`)
  }

  faultPoint('convert:after-purchasing')
  await deliverAudit(tenantId, id)
  const po = outcome.po
  const { emitDomainEvent } = await import('./domain-events')
  void emitDomainEvent(
    tenantId,
    'purchasing.po_created',
    {
      purchaseOrderId: po.id,
      number: po.number,
      supplierId: po.supplierId,
      supplierName: po.supplier.name,
      status: po.status,
      requisitionId: id,
      lines: po.lines.map((l) => ({ lineNo: l.lineNo, skuCode: l.skuCode, qtyOrdered: l.qtyOrdered })),
    },
    { key: po.id },
  )
  return { purchaseOrder: po, created: true }
}

async function finishRetry(tenantId: string, row: { id: string; purchaseOrderId: string | null }, number?: string): Promise<ConversionResult> {
  const po = await existingConversion(tenantId, row, number)
  // A retry also finishes a conversion whose audit delivery failed.
  await deliverAudit(tenantId, row.id)
  return { purchaseOrder: po, created: false }
}

async function deliverAudit(tenantId: string, requisitionId: string) {
  try {
    await deliverRequisitionEvents(tenantId, { requisitionId })
  } catch (err) {
    // The event is durable in the outbox; the next read, retry or reconcile delivers it.
    console.error('[requisitions] conversion audit delivery failed; recovery will retry:', err)
  }
}

// ---------------------------------------------------------------- the converted PO

type PoWithLines = Prisma.PurchaseOrderGetPayload<{ include: { lines: true } }>

/** Loads and verifies the approved requisition behind a converted PO. */
async function approvedSourceOf(tenantId: string, po: PoWithLines) {
  const refuse = (why: string) => new ApiError(409, `This PO's approved requisition is not valid: ${why}`)
  const req = await purchasingDb.purchaseRequisition.findFirst({
    where: { id: po.requisitionId as string, tenantId },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  })
  if (!req) throw refuse('the requisition was not found')
  if (req.status !== PurchaseRequisitionStatus.CONVERTED || req.purchaseOrderId !== po.id) {
    throw refuse('the requisition does not link back to this PO')
  }
  await verifyApprovedSource(tenantId, req)
  return req
}

const landedSum = (x: { freightAmount: Prisma.Decimal; dutyAmount: Prisma.Decimal; otherLandedAmount: Prisma.Decimal }) =>
  new Prisma.Decimal(x.freightAmount.toString()).plus(x.dutyAmount.toString()).plus(x.otherLandedAmount.toString()) // money-ok: copies of stored Decimals via their exact strings

function landedCapProblem(
  approved: { freightAmount: Prisma.Decimal; dutyAmount: Prisma.Decimal; otherLandedAmount: Prisma.Decimal },
  next: { freightAmount: Prisma.Decimal; dutyAmount: Prisma.Decimal; otherLandedAmount: Prisma.Decimal },
): string | null {
  const cap = landedSum(approved)
  const total = landedSum(next)
  return total.gt(cap)
    ? `Landed costs would total ${canonicalDecimal(total)}, above the ${canonicalDecimal(cap)} approved on the requisition. Raise a new requisition for more.`
    : null
}

/** Why the PO no longer matches its approval, or null. Lines, supplier and currency must be equal; landed within cap. */
function poMismatch(po: PoWithLines, req: RequisitionWithLines): string | null {
  if (po.supplierId !== req.supplierId) return 'the supplier differs'
  if (po.currency !== req.currency) return 'the currency differs'
  const lines = [...po.lines].sort((a, b) => a.lineNo - b.lineNo)
  const approved = [...req.lines].sort((a, b) => a.lineNo - b.lineNo)
  if (lines.length !== approved.length) return 'the lines differ'
  for (let i = 0; i < lines.length; i++) {
    const p = lines[i]
    const a = approved[i]
    const sameCost = p.unitCost != null && a.unitCost != null && new Prisma.Decimal(p.unitCost.toString()).equals(a.unitCost.toString()) // money-ok: compares stored Decimals via their exact strings
    if (p.lineNo !== a.lineNo || p.skuCode !== a.skuCode || p.description !== a.description || p.qtyOrdered !== a.qtyRequested || !sameCost) {
      return `line ${p.lineNo} differs`
    }
  }
  return landedCapProblem(req, po)
}

/**
 * Submits a DRAFT PO that was converted from a requisition. The requisition approval stands in for the PO threshold
 * approval, so this goes straight to SUBMITTED, but only after re-verifying the approval and that the PO still
 * matches it.
 */
export async function submitConvertedPurchaseOrder(tenantId: string, po: PoWithLines) {
  if (po.status !== PurchaseOrderStatus.DRAFT) throw new ApiError(400, 'Only DRAFT orders can be submitted')
  const req = await approvedSourceOf(tenantId, po)
  const mismatch = poMismatch(po, req)
  if (mismatch) throw new ApiError(409, `This PO no longer matches its approved requisition ${req.number}: ${mismatch}`)
  const res = await purchasingDb.purchaseOrder.updateMany({
    where: {
      id: po.id,
      tenantId,
      status: PurchaseOrderStatus.DRAFT,
      requisitionId: req.id,
      freightAmount: po.freightAmount,
      dutyAmount: po.dutyAmount,
      otherLandedAmount: po.otherLandedAmount,
    },
    data: { status: PurchaseOrderStatus.SUBMITTED },
  })
  if (res.count !== 1) throw new ApiError(409, 'The PO changed at the same time; reload and try again')
}

/**
 * Applies a landed-cost change to a converted PO, refusing one that would take landed costs above the approved sum.
 * Amounts follow the requisition rules (exact, at most 4 decimals). The write is conditional on the values the check
 * used, so two concurrent partial changes cannot combine to exceed the cap.
 */
export async function updateConvertedLandedCosts(
  tenantId: string,
  po: PoWithLines,
  patch: { freightAmount?: unknown; dutyAmount?: unknown; otherLandedAmount?: unknown; landedCostNotes?: string | null },
) {
  const req = await approvedSourceOf(tenantId, po)
  const next = {
    freightAmount: patch.freightAmount !== undefined ? parseAmount(patch.freightAmount, 'freightAmount') : po.freightAmount,
    dutyAmount: patch.dutyAmount !== undefined ? parseAmount(patch.dutyAmount, 'dutyAmount') : po.dutyAmount,
    otherLandedAmount: patch.otherLandedAmount !== undefined ? parseAmount(patch.otherLandedAmount, 'otherLandedAmount') : po.otherLandedAmount,
  }
  const problem = landedCapProblem(req, next)
  if (problem) throw new ApiError(409, problem)
  const res = await purchasingDb.purchaseOrder.updateMany({
    where: {
      id: po.id,
      tenantId,
      requisitionId: req.id,
      status: { notIn: [PurchaseOrderStatus.CANCELLED, PurchaseOrderStatus.CLOSED] },
      freightAmount: po.freightAmount,
      dutyAmount: po.dutyAmount,
      otherLandedAmount: po.otherLandedAmount,
    },
    data: { ...next, ...(patch.landedCostNotes !== undefined ? { landedCostNotes: patch.landedCostNotes } : {}) },
  })
  if (res.count !== 1) throw new ApiError(409, 'The PO changed at the same time; reload and try again')
}
