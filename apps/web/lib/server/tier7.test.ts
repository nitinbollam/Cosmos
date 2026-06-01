import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInvoiceHtml } from './invoice-document'

test('buildInvoiceHtml includes invoice number and balance', async () => {
  const html = await buildInvoiceHtml('t1', {
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
  })
  assert.match(html, /INV-TEST/)
  assert.match(html, /\$57\.00/)
})
