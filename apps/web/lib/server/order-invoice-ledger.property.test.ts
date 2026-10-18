import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Prisma } from '@/generated/prisma-order'
import { ledgerDb } from './db'
import { allocateShipmentTax, lineSubtotal, priceShipment, type BillableLine } from './invoice-pricing'
import { splitBaseAmounts } from './invoice-tax-split'
import { ensurePostingAccounts } from './ledger-posting'
import { postJob } from './posting-outbox'
import { toBaseDecimal } from './fx-util'
import { percentOf } from './money'

const D = (v: string | number) => new Prisma.Decimal(v)

// Small deterministic generator so a failure reproduces from the seed in its message.
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))

test('property: order total = sum of shipment invoices = ledger, to the cent, for random orders and tax rates', async () => {
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed)
    const tenantId = `t-${randomUUID()}`
    await ensurePostingAccounts(tenantId)

    const lines: BillableLine[] = Array.from({ length: int(r, 1, 5) }, (_, i) => ({
      id: `l${i}`,
      skuId: `s${i % 3}`,
      quantity: int(r, 1, 9),
      quantityInvoiced: 0,
      unitPrice: D(int(r, 1, 99_999)).div(100),
    }))
    const rate = D(int(r, 0, 1250)).div(10_000) // 0% to 12.5%
    const orderSubtotal = lineSubtotal(lines)
    const orderTax = percentOf(orderSubtotal, rate)
    const orderTotal = orderSubtotal.plus(orderTax)
    const fx = r() < 0.5 ? '1' : D(int(r, 5_000, 20_000)).div(10_000).toString()

    // Ship the order in 1 to 4 random partial shipments.
    let invoicedTax = D(0)
    let invoicedSubtotal = D(0)
    let baseTotalSum = D(0)
    let baseTaxSum = D(0)
    let debitAR = D(0)
    let creditRevenue = D(0)
    let creditTax = D(0)
    const open = lines.map((l) => ({ ...l }))
    for (let ship = 0; open.some((l) => l.quantity > l.quantityInvoiced); ship++) {
      const last = ship >= 3
      const shipped = open
        .filter((l) => l.quantity > l.quantityInvoiced)
        .map((l) => ({
          skuId: l.skuId,
          lineId: l.id,
          quantity: last ? l.quantity - l.quantityInvoiced : int(r, 0, l.quantity - l.quantityInvoiced),
        }))
      const pricing = priceShipment(open, shipped)
      if (pricing.subtotal.isZero()) continue
      for (const a of pricing.allocations) open.find((l) => l.id === a.lineId)!.quantityInvoiced += a.quantity
      const completes = open.every((l) => l.quantityInvoiced >= l.quantity)
      const tax = allocateShipmentTax({
        orderSubtotal,
        orderTax,
        invoicedTaxSoFar: invoicedTax,
        shipmentSubtotal: pricing.subtotal,
        completesOrder: completes,
      })
      invoicedTax = invoicedTax.plus(tax)
      invoicedSubtotal = invoicedSubtotal.plus(pricing.subtotal)

      const total = pricing.subtotal.plus(tax)
      const split = splitBaseAmounts(total, tax, fx)
      assert.ok(split.baseRevenue.plus(split.baseTax).eq(split.baseTotal), `seed ${seed}: split adds back`)
      assert.ok(split.baseTax.lte(split.baseTotal), `seed ${seed}: tax never exceeds total`)
      baseTotalSum = baseTotalSum.plus(split.baseTotal)
      baseTaxSum = baseTaxSum.plus(split.baseTax)

      const entryId = await postJob({
        id: randomUUID(),
        tenantId,
        kind: 'INVOICE_JOURNAL',
        sourceType: 'Invoice',
        sourceId: `inv-${ship}`,
        variant: '',
        payload: { amount: split.baseTotal.toFixed(2), taxAmount: split.baseTax.toFixed(2) },
      })
      const entry = await ledgerDb.journalEntry.findFirstOrThrow({
        where: { id: entryId!, tenantId },
        include: { lines: { include: { account: true } } },
      })
      const debit = entry.lines.reduce((s, l) => s.plus(l.debit.toString()), D(0))
      const credit = entry.lines.reduce((s, l) => s.plus(l.credit.toString()), D(0))
      assert.ok(debit.eq(credit), `seed ${seed}: journal entry balances`)
      for (const l of entry.lines) {
        if (l.account.code === '1200') debitAR = debitAR.plus(l.debit.toString())
        if (l.account.code === '4000') creditRevenue = creditRevenue.plus(l.credit.toString())
        if (l.account.code === '2200') creditTax = creditTax.plus(l.credit.toString())
      }
    }

    assert.ok(invoicedSubtotal.eq(orderSubtotal), `seed ${seed}: invoices bill the whole subtotal`)
    assert.ok(invoicedTax.eq(orderTax), `seed ${seed}: invoice tax sums to order tax`)
    assert.ok(invoicedSubtotal.plus(invoicedTax).eq(orderTotal), `seed ${seed}: invoices sum to order total`)
    // Ledger = invoices converted to base, to the cent.
    assert.ok(debitAR.eq(baseTotalSum), `seed ${seed}: AR debits equal invoiced base totals`)
    assert.ok(creditTax.eq(baseTaxSum), `seed ${seed}: sales tax payable equals invoiced base tax`)
    assert.ok(creditRevenue.plus(creditTax).eq(debitAR), `seed ${seed}: revenue + tax = AR`)
    if (fx === '1') assert.ok(debitAR.eq(orderTotal), `seed ${seed}: at fx 1 the ledger equals the order total`)
  }
})

test('base conversion rounds half away from zero in decimal, not through binary floats', () => {
  assert.equal(toBaseDecimal(1.005, 1).toFixed(2), '1.01')
  assert.equal(toBaseDecimal('1.005', '1').toFixed(2), '1.01')
  assert.equal(toBaseDecimal(-1.005, 1).toFixed(2), '-1.01')
  assert.equal(toBaseDecimal(10, '0.735').toFixed(2), '7.35')
})

test('API money is a two-decimal string: format is stable for whole, fractional and large amounts', async () => {
  const { formatMoney } = await import('./money')
  assert.equal(formatMoney('5'), '5.00')
  assert.equal(formatMoney('0.1'), '0.10')
  assert.equal(formatMoney(D('1234567.891')), '1234567.89')
  assert.equal(formatMoney('-0.005'), '-0.01')
  assert.equal(formatMoney('999999999999.995'), '1000000000000.00')
})
