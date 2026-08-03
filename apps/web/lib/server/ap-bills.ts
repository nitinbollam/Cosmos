import { Prisma, VendorBillStatus, BillMatchStatus } from '@/generated/prisma-purchasing'
import { purchasingDb } from './db'
import { postApPaymentJournal, postPoReceiptJournal } from './operations-gl'
import { ApiError } from './session'

function toNum(v: unknown): number {
  if (v == null) return 0
  return Number(v)
}

function billBalance(total: number, paid: number): number {
  return Math.max(0, +(total - paid).toFixed(2))
}

function deriveBillStatus(total: number, paid: number, stored: VendorBillStatus): string {
  const bal = billBalance(total, paid)
  if (stored === VendorBillStatus.VOID) return 'VOID'
  if (bal <= 0.01) return 'PAID'
  if (paid > 0.01) return 'PARTIALLY_PAID'
  return stored === VendorBillStatus.DRAFT ? 'DRAFT' : 'ISSUED'
}

function formatBillNumber(poNumber: string, seq = 1): string {
  return `BILL-${poNumber.replace(/^PO-/i, '')}-${seq}`
}

export type ThreeWayMatchResult = {
  matchStatus: BillMatchStatus
  matchNotes: string | null
  poTotal: number
  receivedTotal: number
  billTotal: number
}

export function computeThreeWayMatch(input: {
  poLines: Array<{ qtyOrdered: number; qtyReceived: number; unitCost: number | null }>
  billLines: Array<{ quantity: number; unitCost: number; skuCode?: string | null }>
  /** Expected landed charges (freight/duty/other) billed alongside goods. */
  landedExpected?: number
}): ThreeWayMatchResult {
  const poTotal = +input.poLines.reduce((s, l) => s + l.qtyOrdered * toNum(l.unitCost), 0).toFixed(2)
  const receivedTotal = +(
    input.poLines.reduce((s, l) => s + l.qtyReceived * toNum(l.unitCost), 0) + (input.landedExpected ?? 0)
  ).toFixed(2)
  const billTotal = +input.billLines.reduce((s, l) => s + l.quantity * l.unitCost, 0).toFixed(2)

  // Lines with an explicit null skuCode (landed charges) are amount-checked via
  // receivedTotal rather than quantity-matched against PO lines.
  const goodsLines = input.billLines.filter((bl) => bl.skuCode !== null)
  const qtyOk = goodsLines.every((bl, i) => {
    const po = input.poLines[i]
    return po && bl.quantity <= po.qtyReceived
  })
  const amountOk = Math.abs(billTotal - receivedTotal) <= 0.05

  if (qtyOk && amountOk) {
    return { matchStatus: BillMatchStatus.MATCHED, matchNotes: null, poTotal, receivedTotal, billTotal }
  }
  const notes: string[] = []
  if (!qtyOk) notes.push('Bill quantity exceeds received quantity on one or more lines')
  if (!amountOk) notes.push(`Bill total ${billTotal} does not match received total ${receivedTotal}`)
  return {
    matchStatus: BillMatchStatus.EXCEPTION,
    matchNotes: notes.join('; '),
    poTotal,
    receivedTotal,
    billTotal,
  }
}

export async function runThreeWayMatch(tenantId: string, billId: string) {
  const bill = await purchasingDb.vendorBill.findFirst({
    where: { id: billId, tenantId },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  })
  if (!bill?.purchaseOrderId) throw new ApiError(400, 'Bill is not linked to a PO')

  const po = await purchasingDb.purchaseOrder.findFirst({
    where: { id: bill.purchaseOrderId, tenantId },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  })
  if (!po) throw new ApiError(404, 'Purchase order not found')

  const { totalLandedCharges } = await import('./landed-cost')
  const landedTotal = totalLandedCharges(po)
  const poBase = po.lines.reduce((s, l) => s + l.qtyOrdered * toNum(l.unitCost), 0)
  const receivedBase = po.lines.reduce((s, l) => s + l.qtyReceived * toNum(l.unitCost), 0)
  const landedExpected =
    landedTotal > 0 && poBase > 0 ? +((landedTotal * receivedBase) / poBase).toFixed(2) : 0

  const match = computeThreeWayMatch({
    poLines: po.lines.map((l) => ({ qtyOrdered: l.qtyOrdered, qtyReceived: l.qtyReceived, unitCost: toNum(l.unitCost) })),
    billLines: bill.lines.map((l) => ({ quantity: l.quantity, unitCost: toNum(l.unitCost), skuCode: l.skuCode })),
    landedExpected,
  })

  return purchasingDb.vendorBill.update({
    where: { id: billId },
    data: {
      matchStatus: match.matchStatus,
      matchNotes: match.matchNotes,
      poTotal: new Prisma.Decimal(match.poTotal),
      receivedTotal: new Prisma.Decimal(match.receivedTotal),
    },
    include: { supplier: true, lines: true },
  })
}

export async function listVendorBills(
  tenantId: string,
  status?: string,
  opts?: { startDate?: string; endDate?: string },
) {
  const where: Prisma.VendorBillWhereInput = { tenantId }
  if (status && status !== 'ALL') where.status = status as VendorBillStatus

  if (opts?.startDate || opts?.endDate) {
    where.issuedAt = {}
    if (opts.startDate) where.issuedAt.gte = new Date(opts.startDate)
    if (opts.endDate) where.issuedAt.lte = new Date(`${opts.endDate}T23:59:59.999Z`)
  }

  const rows = await purchasingDb.vendorBill.findMany({
    where,
    include: { supplier: true, lines: { orderBy: { lineNo: 'asc' } } },
    orderBy: { issuedAt: 'desc' },
    take: 200,
  })

  return rows.map((b) => ({
    ...b,
    balance: billBalance(toNum(b.totalAmount), toNum(b.amountPaid)),
    displayStatus: deriveBillStatus(toNum(b.totalAmount), toNum(b.amountPaid), b.status),
  }))
}

export async function getVendorBill(tenantId: string, id: string) {
  const row = await purchasingDb.vendorBill.findFirst({
    where: { id, tenantId },
    include: { supplier: true, lines: { orderBy: { lineNo: 'asc' } } },
  })
  if (!row) throw new ApiError(404, 'Vendor bill not found')
  return {
    ...row,
    balance: billBalance(toNum(row.totalAmount), toNum(row.amountPaid)),
    displayStatus: deriveBillStatus(toNum(row.totalAmount), toNum(row.amountPaid), row.status),
  }
}

export type CreateBillFromPoInput = {
  purchaseOrderId: string
  dueDays?: number
  notes?: string
}

/** Create a vendor bill from received PO line quantities. */
export async function createBillFromPurchaseOrder(tenantId: string, input: CreateBillFromPoInput) {
  const po = await purchasingDb.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, tenantId },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
  if (!po) throw new ApiError(404, 'Purchase order not found')

  const existing = await purchasingDb.vendorBill.findFirst({
    where: { tenantId, purchaseOrderId: po.id, status: { not: VendorBillStatus.VOID } },
  })

  const billLines = po.lines
    .filter((l) => l.qtyReceived > 0)
    .map((l) => ({
      lineNo: l.lineNo,
      skuCode: l.skuCode,
      description: l.description,
      quantity: l.qtyReceived,
      unitCost: toNum(l.unitCost),
    }))

  if (billLines.length === 0) throw new ApiError(400, 'No received quantities to bill')

  // Landed charges (freight/duty/other) bill in proportion to the received fraction so
  // the AP side stays aligned with inventory, which is posted at landed unit cost.
  const { totalLandedCharges } = await import('./landed-cost')
  const landedTotal = totalLandedCharges(po)
  const poBase = po.lines.reduce((s, l) => s + l.qtyOrdered * toNum(l.unitCost), 0)
  const receivedBase = billLines.reduce((s, l) => s + l.quantity * l.unitCost, 0)
  const landedShare = landedTotal > 0 && poBase > 0 ? +((landedTotal * receivedBase) / poBase).toFixed(2) : 0
  if (landedShare > 0) {
    billLines.push({
      lineNo: (po.lines.at(-1)?.lineNo ?? billLines.length) + 1,
      skuCode: null,
      description: 'Landed charges (freight / duty / other)',
      quantity: 1,
      unitCost: landedShare,
    })
  }

  const subtotal = billLines.reduce((s, l) => s + l.quantity * l.unitCost, 0)
  const totalAmount = +subtotal.toFixed(2)

  if (existing) {
    await purchasingDb.vendorBillLine.deleteMany({ where: { billId: existing.id } })
    await purchasingDb.vendorBill.update({
      where: { id: existing.id },
      data: {
        subtotal: new Prisma.Decimal(subtotal),
        totalAmount: new Prisma.Decimal(totalAmount),
        lines: {
          create: billLines.map((l) => ({
            lineNo: l.lineNo,
            skuCode: l.skuCode,
            description: l.description,
            quantity: l.quantity,
            unitCost: new Prisma.Decimal(l.unitCost),
          })),
        },
      },
    })
    return getVendorBill(tenantId, existing.id)
  }

  const dueDays = input.dueDays && input.dueDays > 0 ? input.dueDays : 30
  const dueAt = new Date()
  dueAt.setDate(dueAt.getDate() + dueDays)

  const bill = await purchasingDb.vendorBill.create({
    data: {
      tenantId,
      supplierId: po.supplierId,
      purchaseOrderId: po.id,
      billNumber: formatBillNumber(po.number),
      status: VendorBillStatus.ISSUED,
      subtotal: new Prisma.Decimal(subtotal),
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(totalAmount),
      dueAt,
      notes: input.notes ?? `Bill for ${po.number}`,
      lines: {
        create: billLines.map((l) => ({
          lineNo: l.lineNo,
          skuCode: l.skuCode,
          description: l.description,
          quantity: l.quantity,
          unitCost: new Prisma.Decimal(l.unitCost),
        })),
      },
    },
    include: { supplier: true, lines: true },
  })

  const journalEntryId = await postPoReceiptJournal(tenantId, bill.id, totalAmount).catch(() => null)
  if (journalEntryId) {
    await purchasingDb.vendorBill.update({ where: { id: bill.id }, data: { journalEntryId } })
  }

  await runThreeWayMatch(tenantId, bill.id).catch(() => undefined)

  return getVendorBill(tenantId, bill.id)
}

export async function recordBillPayment(
  tenantId: string,
  billId: string,
  body: { amount: number; method: string; reference?: string },
) {
  const bill = await getVendorBill(tenantId, billId)
  if (bill.status === VendorBillStatus.VOID) throw new ApiError(400, 'Cannot pay a void bill')

  const total = toNum(bill.totalAmount)
  const paid = toNum(bill.amountPaid)
  const remaining = billBalance(total, paid)
  const apply = Math.min(body.amount, remaining)
  if (apply <= 0) throw new ApiError(400, 'Nothing to pay or invalid amount')

  void body.method
  void body.reference

  const newPaid = paid + apply
  const newStatus =
    billBalance(total, newPaid) <= 0.01
      ? VendorBillStatus.PAID
      : newPaid > 0
        ? VendorBillStatus.PARTIALLY_PAID
        : bill.status

  const updated = await purchasingDb.vendorBill.update({
    where: { id: billId },
    data: {
      amountPaid: new Prisma.Decimal(newPaid),
      status: newStatus,
    },
    include: { supplier: true, lines: true },
  })

  await postApPaymentJournal(tenantId, billId, apply).catch(() => undefined)

  return {
    ...updated,
    balance: billBalance(toNum(updated.totalAmount), toNum(updated.amountPaid)),
    displayStatus: deriveBillStatus(toNum(updated.totalAmount), toNum(updated.amountPaid), updated.status),
  }
}
