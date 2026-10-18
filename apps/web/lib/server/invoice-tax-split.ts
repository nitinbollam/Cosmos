import { Prisma } from '@/generated/prisma-order'
import { toBaseAmount } from './fx-util'

/**
 * Splits an invoice (or shipment extension, or credit memo) into base-currency revenue and sales
 * tax. Total and tax are each converted once, and revenue is the difference, so the pieces always
 * add back to the converted total to the cent: any rounding falls on revenue, never on the tax
 * owed to the state.
 */
export function splitBaseAmounts(total: number | string, tax: number | string, fxRateToBase: number) {
  const baseTotal = new Prisma.Decimal(toBaseAmount(Number(total), fxRateToBase))
  let baseTax = new Prisma.Decimal(toBaseAmount(Number(tax), fxRateToBase))
  if (baseTax.lt(0)) baseTax = new Prisma.Decimal(0)
  if (baseTax.gt(baseTotal)) baseTax = baseTotal
  return { baseTotal, baseTax, baseRevenue: baseTotal.minus(baseTax) }
}
