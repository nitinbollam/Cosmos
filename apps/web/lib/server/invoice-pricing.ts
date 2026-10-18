import { Prisma } from '@/generated/prisma-order'
import { ApiError } from './session'

/**
 * PLR-155: price a shipment from the order lines it actually came from, using exact decimal math.
 * Previously every unit of a SKU was billed at the first line's price, so orders carrying the same
 * SKU on several lines (promo + regular, contract tiers, different warehouses) were mis-billed.
 */

const ZERO = new Prisma.Decimal(0)

export type BillableLine = {
  id: string
  skuId: string
  quantity: number
  quantityInvoiced: number
  unitPrice: Prisma.Decimal
}

export type ShippedInput = { skuId: string; quantity: number; lineId?: string }

export type LineAllocation = { lineId: string; quantity: number; amount: Prisma.Decimal }

export type ShipmentPricing = {
  allocations: LineAllocation[]
  subtotal: Prisma.Decimal
}

function money(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

/**
 * Allocate shipped units to order lines. A shipped entry that names a line bills that line; otherwise
 * units fill the SKU's lines in order, using each line's remaining (ordered - already invoiced)
 * quantity. Billing more units than the order still has open is rejected, never silently dropped.
 */
export function priceShipment(lines: BillableLine[], shipped: ShippedInput[]): ShipmentPricing {
  const remaining = new Map<string, number>(lines.map((l) => [l.id, l.quantity - l.quantityInvoiced]))
  const byId = new Map(lines.map((l) => [l.id, l]))
  const taken = new Map<string, number>()

  const take = (line: BillableLine, qty: number): number => {
    const room = remaining.get(line.id) ?? 0
    const n = Math.min(room, qty)
    if (n > 0) {
      remaining.set(line.id, room - n)
      taken.set(line.id, (taken.get(line.id) ?? 0) + n)
    }
    return qty - n
  }

  for (const s of shipped) {
    if (!Number.isInteger(s.quantity) || s.quantity < 0) {
      throw new ApiError(400, `Invalid shipped quantity for sku ${s.skuId}`)
    }
    let left = s.quantity
    if (left === 0) continue
    if (s.lineId) {
      const line = byId.get(s.lineId)
      if (!line || line.skuId !== s.skuId) throw new ApiError(409, `Shipped line ${s.lineId} does not match sku ${s.skuId}`)
      left = take(line, left)
    }
    for (const line of lines) {
      if (left === 0) break
      if (line.skuId === s.skuId) left = take(line, left)
    }
    if (left > 0) {
      throw new ApiError(409, `Shipment bills ${left} more unit(s) of sku ${s.skuId} than the order has left to invoice`)
    }
  }

  const allocations: LineAllocation[] = []
  let subtotal = ZERO
  for (const line of lines) {
    const qty = taken.get(line.id)
    if (!qty) continue
    const amount = money(line.unitPrice.mul(qty))
    allocations.push({ lineId: line.id, quantity: qty, amount })
    subtotal = subtotal.add(amount)
  }
  return { allocations, subtotal }
}

/**
 * Tax for this shipment. Pro-rata of the order's tax on the shipped share of the order subtotal;
 * the shipment that completes the order takes the exact remainder, so all invoices sum to the order
 * tax to the cent (3 x $3.33 with $0.82 tax bills 0.27 + 0.27 + 0.28).
 */
export function allocateShipmentTax(args: {
  orderSubtotal: Prisma.Decimal
  orderTax: Prisma.Decimal
  invoicedTaxSoFar: Prisma.Decimal
  shipmentSubtotal: Prisma.Decimal
  completesOrder: boolean
}): Prisma.Decimal {
  const { orderSubtotal, orderTax, invoicedTaxSoFar, shipmentSubtotal, completesOrder } = args
  if (orderSubtotal.lte(0) || orderTax.lte(0)) return ZERO
  if (completesOrder) return money(Prisma.Decimal.max(orderTax.sub(invoicedTaxSoFar), ZERO))
  return money(shipmentSubtotal.mul(orderTax).div(orderSubtotal))
}

/** Sum of line extensions at order prices (exact). */
export function lineSubtotal(lines: Array<{ quantity: number; unitPrice: Prisma.Decimal }>): Prisma.Decimal {
  return lines.reduce((s, l) => s.add(money(l.unitPrice.mul(l.quantity))), ZERO)
}

/**
 * Legacy orders invoiced before per-line tracking have quantityInvoiced = 0. Infer what was billed by
 * filling lines in order against the invoice subtotal, so follow-up shipments do not re-bill.
 */
export function inferLegacyInvoiced(lines: BillableLine[], invoiceSubtotal: Prisma.Decimal): BillableLine[] {
  let left = invoiceSubtotal
  return lines.map((l) => {
    let qty = 0
    while (qty < l.quantity && left.gte(l.unitPrice) && l.unitPrice.gt(0)) {
      left = left.sub(l.unitPrice)
      qty++
    }
    return { ...l, quantityInvoiced: qty }
  })
}
