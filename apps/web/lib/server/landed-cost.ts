import { Prisma } from '@/generated/prisma-purchasing'

type PoLine = {
  id: string
  lineNo: number
  qtyOrdered: number
  qtyReceived: number
  unitCost: Prisma.Decimal | null
}

type PoLanded = {
  freightAmount: Prisma.Decimal | null
  dutyAmount: Prisma.Decimal | null
  otherLandedAmount: Prisma.Decimal | null
  lines: PoLine[]
}

function dec(v: Prisma.Decimal | null | undefined): number {
  if (v == null) return 0
  return Number(v)
}

export function totalLandedCharges(po: PoLanded): number {
  return dec(po.freightAmount) + dec(po.dutyAmount) + dec(po.otherLandedAmount)
}

/** Allocate PO-level landed charges across lines by extended product cost (qty × unit cost). */
export function allocateLandedCostPerUnit(
  po: PoLanded,
  lineId: string,
  qtyReceived: number,
): { landedAdderPerUnit: number; lineLandedTotal: number } {
  if (qtyReceived <= 0) return { landedAdderPerUnit: 0, lineLandedTotal: 0 }

  const totalLanded = totalLandedCharges(po)
  if (totalLanded <= 0) return { landedAdderPerUnit: 0, lineLandedTotal: 0 }

  const line = po.lines.find((l) => l.id === lineId)
  if (!line) return { landedAdderPerUnit: 0, lineLandedTotal: 0 }

  const weights = po.lines.map((l) => {
    const cost = dec(l.unitCost)
    const qty = Math.max(l.qtyOrdered, l.qtyReceived, 1)
    return cost > 0 ? cost * qty : qty
  })
  const weightSum = weights.reduce((s, w) => s + w, 0) || po.lines.length
  const lineIndex = po.lines.findIndex((l) => l.id === lineId)
  const share = weights[lineIndex]! / weightSum
  const lineLandedTotal = totalLanded * share
  const landedAdderPerUnit = lineLandedTotal / qtyReceived

  return { landedAdderPerUnit, lineLandedTotal }
}

export function computeReceivedUnitCost(
  baseUnitCost: number,
  po: PoLanded,
  lineId: string,
  qtyReceived: number,
): number {
  const { landedAdderPerUnit } = allocateLandedCostPerUnit(po, lineId, qtyReceived)
  return baseUnitCost + landedAdderPerUnit
}
