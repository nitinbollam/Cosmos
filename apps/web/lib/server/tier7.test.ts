import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInvoiceHtml, buildInvoicePdf } from './invoice-document'

const invoiceFixture = {
  invoiceNumber: 'INV-TEST',
  issuedAt: new Date('2026-05-01'),
  dueAt: new Date('2026-06-01'),
  customerId: 'cust-1',
  subtotal: 100,
  taxAmount: 7,
  totalAmount: 107,
  amountPaid: 50,
  balance: 57,
  displayStatus: 'PARTIALLY_PAID',
  lineItems: [{ skuId: 'sku-1', quantity: 2, unitPrice: 50 }],
}

test('buildInvoiceHtml includes invoice number and balance', async () => {
  const html = await buildInvoiceHtml('t1', invoiceFixture)
  assert.match(html, /INV-TEST/)
  assert.match(html, /\$57\.00/)
})

test('buildInvoicePdf returns valid PDF buffer', async () => {
  const buf = await buildInvoicePdf('t1', invoiceFixture)
  assert.equal(buf.subarray(0, 4).toString(), '%PDF')
  assert.ok(buf.length > 500)
})
