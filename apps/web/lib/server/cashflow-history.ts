import { orderDb, purchasingDb } from './db'
import * as analytics from './analytics'

export type CashflowHistoryPoint = {
  period: string
  inflow: number
  outflow: number
}

export type CashflowHistoryResponse = {
  tenantId: string
  source: 'ar_ap' | 'revenue_proxy'
  weeks: number
  history: CashflowHistoryPoint[]
  warnings: string[]
}

/** Monday UTC week key YYYY-MM-DD for the week containing `d`. */
export function weekStartUtc(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = x.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  x.setUTCDate(x.getUTCDate() + diff)
  return x.toISOString().slice(0, 10)
}

export function emptyWeeklyBuckets(weeks: number, end = new Date()): Map<string, CashflowHistoryPoint> {
  const map = new Map<string, CashflowHistoryPoint>()
  const endWeek = weekStartUtc(end)
  const cursor = new Date(`${endWeek}T00:00:00.000Z`)
  for (let i = weeks - 1; i >= 0; i--) {
    const w = new Date(cursor)
    w.setUTCDate(w.getUTCDate() - i * 7)
    const key = weekStartUtc(w)
    map.set(key, { period: key, inflow: 0, outflow: 0 })
  }
  return map
}

/**
 * Weekly AR collections + AP payments for cashflow EWMA.
 * MVP attribution: invoice/bill `amountPaid` rolled into the week of `issuedAt`
 * (no separate payment ledger dates).
 */
export async function buildArApCashflowHistory(
  tenantId: string,
  weeks = 16,
): Promise<CashflowHistoryResponse> {
  const w = Math.min(26, Math.max(4, weeks))
  const warnings: string[] = []
  const buckets = emptyWeeklyBuckets(w)
  const oldest = [...buckets.keys()][0]!
  const since = new Date(`${oldest}T00:00:00.000Z`)

  const [invoices, bills] = await Promise.all([
    orderDb.invoice.findMany({
      where: { tenantId, issuedAt: { gte: since } },
      select: { issuedAt: true, amountPaid: true, totalAmount: true },
      take: 5000,
    }),
    purchasingDb.vendorBill.findMany({
      where: { tenantId, issuedAt: { gte: since } },
      select: { issuedAt: true, amountPaid: true, totalAmount: true },
      take: 5000,
    }),
  ])

  for (const inv of invoices) {
    const key = weekStartUtc(inv.issuedAt)
    const b = buckets.get(key)
    if (!b) continue
    b.inflow += Number(inv.amountPaid)
  }
  for (const bill of bills) {
    const key = weekStartUtc(bill.issuedAt)
    const b = buckets.get(key)
    if (!b) continue
    b.outflow += Number(bill.amountPaid)
  }

  const history = [...buckets.values()].map((p) => ({
    period: p.period,
    inflow: Math.round(p.inflow * 100) / 100,
    outflow: Math.round(p.outflow * 100) / 100,
  }))

  const activeWeeks = history.filter((p) => p.inflow > 0 || p.outflow > 0).length
  if (activeWeeks < 3) {
    warnings.push('Using revenue proxy — insufficient AR/AP history')
    const proxy = await buildRevenueProxyHistory(tenantId, w)
    return {
      tenantId,
      source: 'revenue_proxy',
      weeks: w,
      history: proxy.history,
      warnings: [...warnings, ...proxy.warnings],
    }
  }

  if (history.every((p) => p.outflow <= 0) && history.some((p) => p.inflow > 0)) {
    warnings.push('No AP payments in window — outflow may understate cash needs.')
  }

  return {
    tenantId,
    source: 'ar_ap',
    weeks: w,
    history,
    warnings,
  }
}

async function buildRevenueProxyHistory(
  tenantId: string,
  weeks: number,
): Promise<{ history: CashflowHistoryPoint[]; warnings: string[] }> {
  const snaps = await analytics.listSnapshots(tenantId)
  const sorted = [...snaps].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  const buckets = emptyWeeklyBuckets(weeks)
  const warnings: string[] = []

  for (const s of sorted) {
    const key = weekStartUtc(new Date(s.date))
    const b = buckets.get(key)
    if (!b) continue
    const rev = Number(s.revenue)
    b.inflow += rev
    b.outflow += Math.max(0, rev * 0.55)
  }

  const history = [...buckets.values()].map((p) => ({
    period: p.period,
    inflow: Math.round(p.inflow * 100) / 100,
    outflow: Math.round(p.outflow * 100) / 100,
  }))

  if (history.filter((p) => p.inflow > 0 || p.outflow > 0).length < 3) {
    warnings.push('KPI revenue history also thin — cashflow forecast may be unreliable.')
  } else {
    warnings.push('Revenue proxy uses estimated outflow (55% of revenue).')
  }

  return { history, warnings }
}
