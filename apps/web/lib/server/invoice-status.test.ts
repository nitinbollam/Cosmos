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

test('toStoredInvoiceStatus maps OVERDUE to ISSUED', () => {
  assert.equal(toStoredInvoiceStatus('OVERDUE'), 'ISSUED')
  assert.equal(toStoredInvoiceStatus('PAID'), 'PAID')
})
