import { createHash } from 'node:crypto'
import { Prisma } from '@/generated/prisma-purchasing'
import { ApiError } from './session'

/**
 * Purchasing details of a requisition: what an approver signs off on and what conversion will copy.
 * Pure functions only, so the hash is the same whether it is computed at submit, at decision or at conversion.
 */

/** Wide enough that sums of quantity x unit cost never round (decimal.js defaults to 20 digits). */
const D = Prisma.Decimal.clone({ precision: 40 })

export const MAX_REQUISITION_LINES = 500
export const MAX_LINE_QTY = 1_000_000
/** Amounts must fit SQLite's REAL storage exactly: at most 4 decimal places and under 1e9 (<= 13 significant digits). */
export const MAX_AMOUNT_DECIMALS = 4
const MAX_AMOUNT = new D('1e9')

export type DetailsLine = {
  lineNo: number
  skuCode: string | null
  description: string
  qtyRequested: number
  unitCost: Prisma.Decimal | null
}

export type RequisitionDetails = {
  supplierId: string | null
  currency: string
  freightAmount: Prisma.Decimal
  dutyAmount: Prisma.Decimal
  otherLandedAmount: Prisma.Decimal
  lines: DetailsLine[]
}

/**
 * Parses a client amount (a decimal string or a JSON number) into an exact Decimal. Rejects instead of rounding:
 * an amount the database cannot store exactly would change after it was approved.
 */
export function parseAmount(raw: unknown, label: string): Prisma.Decimal {
  if (typeof raw !== 'string' && typeof raw !== 'number') throw new ApiError(400, `${label} must be a number`)
  const text = String(raw).trim()
  if (!/^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(text)) throw new ApiError(400, `${label} must be a number`)
  const value = new D(text)
  if (!value.isFinite()) throw new ApiError(400, `${label} must be a number`)
  if (value.isNegative() && !value.isZero()) throw new ApiError(400, `${label} must be 0 or more`)
  if (value.decimalPlaces() > MAX_AMOUNT_DECIMALS) {
    throw new ApiError(400, `${label} can have at most ${MAX_AMOUNT_DECIMALS} decimal places`)
  }
  if (value.gte(MAX_AMOUNT)) throw new ApiError(400, `${label} is too large`)
  return new Prisma.Decimal(value.abs().toFixed()) // money-ok: from the validated decimal string, never a float result
}

/**
 * The one string form of a Decimal used in the hash: plain notation, no exponent, no trailing zeros, no "-0".
 * 4.2500, 4.25 and 4.25e0 all give "4.25". Nothing is rounded.
 */
export function canonicalDecimal(value: Prisma.Decimal | string | number): string {
  const d = new D(typeof value === 'object' ? value.toString() : value)
  if (d.isZero()) return '0'
  const fixed = d.toFixed() // money-ok: Decimal.toFixed() with no argument is exact plain notation, no rounding
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}

export function normalizeCurrency(raw: unknown): string {
  const c = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/.test(c)) throw new ApiError(400, 'currency must be a 3-letter ISO code such as USD')
  return c
}

/** The canonical JSON the hash is taken over. Lines are sorted by lineNo; Decimals use canonicalDecimal. */
export function canonicalDetails(d: RequisitionDetails): string {
  const lines = [...d.lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => [l.lineNo, l.skuCode ?? null, l.description, l.qtyRequested, l.unitCost == null ? null : canonicalDecimal(l.unitCost)])
  return JSON.stringify({
    v: 1,
    supplierId: d.supplierId,
    currency: d.currency,
    freight: canonicalDecimal(d.freightAmount),
    duty: canonicalDecimal(d.dutyAmount),
    other: canonicalDecimal(d.otherLandedAmount),
    lines,
  })
}

export function detailsHash(d: RequisitionDetails): string {
  return createHash('sha256').update(canonicalDetails(d)).digest('hex')
}

/** The details of a stored requisition row (with its lines), in the shape the hash is taken over. */
export function detailsOf(row: {
  supplierId: string | null
  currency: string
  freightAmount: Prisma.Decimal
  dutyAmount: Prisma.Decimal
  otherLandedAmount: Prisma.Decimal
  lines: Array<{ lineNo: number; skuCode: string | null; description: string; qtyRequested: number; unitCost: Prisma.Decimal | null }>
}): RequisitionDetails {
  return {
    supplierId: row.supplierId,
    currency: row.currency,
    freightAmount: row.freightAmount,
    dutyAmount: row.dutyAmount,
    otherLandedAmount: row.otherLandedAmount,
    lines: row.lines.map((l) => ({ lineNo: l.lineNo, skuCode: l.skuCode, description: l.description, qtyRequested: l.qtyRequested, unitCost: l.unitCost })),
  }
}

/** Lines plus landed amounts, exact. Unpriced lines count as 0 (only drafts can have them). */
export function requisitionTotal(d: Pick<RequisitionDetails, 'freightAmount' | 'dutyAmount' | 'otherLandedAmount' | 'lines'>): string {
  let total = new D(0)
  for (const l of d.lines) {
    if (l.unitCost != null) total = total.plus(new D(l.unitCost.toString()).times(l.qtyRequested))
  }
  total = total.plus(d.freightAmount.toString()).plus(d.dutyAmount.toString()).plus(d.otherLandedAmount.toString())
  return canonicalDecimal(total.toFixed()) // money-ok: exact Decimal sum printed without rounding
}

/** What submission requires beyond what a draft may hold. Returns the first problem, or null. */
export function submissionProblem(d: RequisitionDetails): string | null {
  if (!d.supplierId) return 'Choose a supplier before submitting'
  if (!/^[A-Z]{3}$/.test(d.currency)) return 'currency must be a 3-letter ISO code such as USD'
  if (d.lines.length === 0) return 'Add at least one line before submitting'
  for (const l of d.lines) {
    if (!Number.isInteger(l.qtyRequested) || l.qtyRequested <= 0) return `Line ${l.lineNo}: quantity must be more than 0`
    if (l.unitCost == null) return `Line ${l.lineNo}: enter a unit cost (0 is allowed)`
    if (l.unitCost.isNegative() && !l.unitCost.isZero()) return `Line ${l.lineNo}: unit cost must be 0 or more`
  }
  return null
}
