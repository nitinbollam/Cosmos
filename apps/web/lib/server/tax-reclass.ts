import { Prisma } from '@/generated/prisma-ledger'
import { ledgerDb, orderDb } from './db'
import { toBaseAmount } from './fx-util'
import { createJournalOnce, requireAccounts, requireSalesTaxPayable, SALES_TAX_PAYABLE } from './ledger-posting'

/**
 * PLR-149 backfill. Before tax was split out of revenue, every invoice credited its full total
 * (tax included) to Sales Revenue. For each invoice with tax, this moves the tax still owed from
 * Revenue to Sales Tax Payable with one correcting entry:
 *
 *   Dr 4000 Sales Revenue   Cr 2200 Sales Tax Payable
 *
 * The amount is the invoice's current tax (already net of any credit memos) in base currency, less
 * what is already booked to Sales Tax Payable for that invoice and its credit memos. Invoices posted
 * after the fix therefore need nothing, and running it twice posts nothing the second time (the
 * entry is also keyed `TAX_RECLASS`/invoice id, so a concurrent run cannot double it).
 * Entries are dated when they are posted; nothing is back-dated into a closed period.
 */

export type TaxReclassRow = {
  tenantId: string
  invoiceId: string
  invoiceNumber: string
  baseTax: string
  alreadyBooked: string
  reclass: string
  note?: string
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

export async function planTaxReclass(tenantId?: string): Promise<TaxReclassRow[]> {
  const invoices = await orderDb.invoice.findMany({
    where: { ...(tenantId ? { tenantId } : {}), taxAmount: { gt: 0 }, journalEntryId: { not: null } },
    select: { id: true, tenantId: true, invoiceNumber: true, taxAmount: true, fxRateToBase: true, creditMemos: { select: { id: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const rows: TaxReclassRow[] = []
  for (const inv of invoices) {
    const baseTax = D(toBaseAmount(Number(inv.taxAmount), Number(inv.fxRateToBase)))
    const payable = await ledgerDb.chartAccount.findFirst({
      where: { tenantId: inv.tenantId, code: SALES_TAX_PAYABLE },
      select: { id: true },
    })
    let booked = D(0)
    if (payable) {
      const lines = await ledgerDb.journalLine.findMany({
        where: {
          accountId: payable.id,
          entry: {
            tenantId: inv.tenantId,
            OR: [
              { sourceType: 'Invoice', sourceId: inv.id },
              { sourceType: 'CreditMemo', sourceId: { in: inv.creditMemos.map((m) => m.id) } },
              { sourceType: 'TAX_RECLASS', sourceId: inv.id },
            ],
          },
        },
        select: { debit: true, credit: true },
      })
      booked = lines.reduce((s, l) => s.plus(l.credit).minus(l.debit), D(0))
    }
    const reclass = baseTax.minus(booked)
    const row: TaxReclassRow = {
      tenantId: inv.tenantId,
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      baseTax: baseTax.toFixed(2),
      alreadyBooked: booked.toFixed(2),
      reclass: reclass.toFixed(2),
    }
    if (reclass.lt(0)) row.note = 'more tax booked than the invoice carries: review by hand'
    if (reclass.lte(0)) {
      if (reclass.lt(0)) rows.push(row)
      continue
    }
    rows.push(row)
  }
  return rows
}

export async function applyTaxReclass(rows: TaxReclassRow[]): Promise<number> {
  let posted = 0
  for (const r of rows) {
    if (!(Number(r.reclass) > 0)) continue
    const a = await requireAccounts(r.tenantId, ['4000'])
    const payable = await requireSalesTaxPayable(r.tenantId)
    const amount = D(r.reclass)
    await createJournalOnce(
      r.tenantId,
      { sourceType: 'TAX_RECLASS', sourceId: r.invoiceId },
      `Reclassify sales tax on invoice ${r.invoiceNumber} from revenue to Sales Tax Payable`,
      [
        { accountId: a.get('4000')!.id, memo: 'Sales tax removed from revenue', debit: amount, credit: D(0) },
        { accountId: payable.id, memo: 'Sales tax payable', debit: D(0), credit: amount },
      ],
    )
    posted++
  }
  return posted
}
