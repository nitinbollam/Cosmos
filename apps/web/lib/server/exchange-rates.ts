import { Prisma } from '@/generated/prisma-ledger'
import { ledgerDb, orderDb, purchasingDb, tenantDb } from './db'
import { ApiError } from './session'
import { getTenantFinanceSettings } from './tenant-finance-settings'
import { normalizeCurrency } from './fx-util'

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  return x
}

export async function getRate(fromCurrency: string, toCurrency: string, asOfDate: string): Promise<number> {
  const from = normalizeCurrency(fromCurrency)
  const to = normalizeCurrency(toCurrency)
  if (from === to) return 1

  const asOf = startOfDay(new Date(asOfDate))
  const row = await ledgerDb.exchangeRate.findFirst({
    where: {
      fromCurrency: from,
      toCurrency: to,
      asOfDate: { lte: asOf },
    },
    orderBy: { asOfDate: 'desc' },
  })
  if (row) {
    return Number(row.rate)
  }

  // Fallback: check inverse currency pair rate (to -> from)
  const inverse = await ledgerDb.exchangeRate.findFirst({
    where: {
      fromCurrency: to,
      toCurrency: from,
      asOfDate: { lte: asOf },
    },
    orderBy: { asOfDate: 'desc' },
  })
  if (inverse && Number(inverse.rate) > 0) {
    return +(1 / Number(inverse.rate)).toFixed(6)
  }

  throw new ApiError(400, `No exchange rate found for ${from} → ${to} on or before ${asOfDate}`)
}

async function collectCurrencyPairs(): Promise<Array<{ from: string; to: string }>> {
  const pairs = new Map<string, { from: string; to: string }>()
  const add = (from: string, to: string) => {
    const f = normalizeCurrency(from)
    const t = normalizeCurrency(to)
    if (f === t) return
    pairs.set(`${f}:${t}`, { from: f, to: t })
  }

  const invoices = await orderDb.invoice.findMany({ select: { currency: true, tenantId: true }, distinct: ['currency', 'tenantId'] })
  const bills = await purchasingDb.vendorBill.findMany({ select: { currency: true, tenantId: true }, distinct: ['currency', 'tenantId'] })
  const pos = await purchasingDb.purchaseOrder.findMany({ select: { currency: true, tenantId: true }, distinct: ['currency', 'tenantId'] })
  const tenants = await tenantDb.tenantOrganization.findMany({ select: { id: true, settings: true } })

  const baseByTenant = new Map<string, string>()
  for (const t of tenants) {
    const settings = t.settings as Record<string, unknown> | null
    const base =
      typeof settings?.baseCurrency === 'string' ? normalizeCurrency(settings.baseCurrency) : 'USD'
    baseByTenant.set(t.id, base)
  }

  for (const inv of invoices) {
    add(inv.currency, baseByTenant.get(inv.tenantId) ?? 'USD')
  }
  for (const bill of bills) {
    add(bill.currency, baseByTenant.get(bill.tenantId) ?? 'USD')
  }
  for (const po of pos) {
    add(po.currency, baseByTenant.get(po.tenantId) ?? 'USD')
  }
  for (const base of new Set(baseByTenant.values())) {
    if (base !== 'USD') add(base, 'USD')
  }

  return [...pairs.values()]
}

export async function fetchAndCacheDailyRates(): Promise<{ pairs: number }> {
  const pairs = await collectCurrencyPairs()
  const today = startOfDay(new Date())
  let count = 0

  for (const { from, to } of pairs) {
    const url = `https://api.exchangerate.host/convert?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    const res = await fetch(url)
    if (!res.ok) throw new ApiError(502, `Exchange rate API failed for ${from}/${to}`)
    const body = (await res.json()) as { result?: number; success?: boolean }
    const rate = body.result
    if (typeof rate !== 'number' || rate <= 0) {
      throw new ApiError(502, `Invalid exchange rate for ${from}/${to}`)
    }

    await ledgerDb.exchangeRate.upsert({
      where: {
        fromCurrency_toCurrency_asOfDate: {
          fromCurrency: from,
          toCurrency: to,
          asOfDate: today,
        },
      },
      create: {
        fromCurrency: from,
        toCurrency: to,
        rate: new Prisma.Decimal(rate),
        asOfDate: today,
      },
      update: { rate: new Prisma.Decimal(rate) },
    })
    count += 1
  }

  return { pairs: count }
}

export async function resolveFxRateAtCreation(
  tenantId: string,
  currency: string,
  asOfDate = new Date().toISOString().slice(0, 10),
): Promise<{ currency: string; fxRateToBase: number }> {
  const normalized = normalizeCurrency(currency)
  const { baseCurrency } = await getTenantFinanceSettings(tenantId)
  const fxRateToBase = await getRate(normalized, baseCurrency, asOfDate)
  return { currency: normalized, fxRateToBase }
}
