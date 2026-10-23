import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveInvoiceStatus,
  formatCreditMemoNumber,
  formatInvoiceNumber,
  invoiceBalance,
  toStoredInvoiceStatus,
} from './invoice-status'

test('formatInvoiceNumber uses order id suffix', () => {
  assert.equal(formatInvoiceNumber('abc12345'), 'INV-ABC12345')
})

test('formatCreditMemoNumber includes sequence', () => {
  assert.equal(formatCreditMemoNumber('order123456', 2), 'CM-123456-2')
})

test('invoiceBalance subtracts paid and credited', () => {
  assert.equal(invoiceBalance(100, 40, 10), 50)
  assert.equal(invoiceBalance(100, 120, 0), 0)
})

test('deriveInvoiceStatus marks overdue NET_TERMS', () => {
  const old = new Date(Date.now() - 45 * 86400000).toISOString()
  assert.equal(
    deriveInvoiceStatus({
      totalAmount: 100,
      amountPaid: 0,
      amountCredited: 0,
      paymentMethod: 'NET_TERMS',
      issuedAt: old,
    }),
    'OVERDUE',
  )
})

test('invoiceBalance and deriveInvoiceStatus are exact to the cent', () => {
  assert.equal(invoiceBalance(51.04, 51.03, 0), 0.01)
  assert.equal(invoiceBalance(0.3, 0.1, 0.2), 0)
  const status = (amountPaid: number, totalAmount = 51.04, amountCredited = 0) =>
    deriveInvoiceStatus({ totalAmount, amountPaid, amountCredited })
  assert.equal(status(51.03), 'PARTIALLY_PAID') // one cent still owed is not paid
  assert.equal(status(0.01), 'PARTIALLY_PAID') // one cent paid is a payment
  assert.equal(status(51.04), 'PAID')
  assert.equal(status(0, 0.01), 'ISSUED')
  assert.equal(status(0, 10, 10), 'CREDITED')
})

test('toStoredInvoiceStatus maps OVERDUE to ISSUED', () => {
  assert.equal(toStoredInvoiceStatus('OVERDUE'), 'ISSUED')
  assert.equal(toStoredInvoiceStatus('PAID'), 'PAID')
})
