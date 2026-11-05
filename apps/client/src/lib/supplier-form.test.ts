import assert from 'node:assert/strict'
import test from 'node:test'
import { supplierFormErrors } from './supplier-form'

test('supplier code and name are required after trimming', () => {
  assert.deepEqual(supplierFormErrors({ code: '  ', name: '', email: '' }), {
    code: 'Enter a supplier code.',
    name: 'Enter a supplier name.',
    email: '',
  })
})

test('supplier email is optional but validated when entered', () => {
  assert.equal(supplierFormErrors({ code: 'SUP-1', name: 'Supplier', email: '' }).email, '')
  assert.equal(supplierFormErrors({ code: 'SUP-1', name: 'Supplier', email: '  contact@example.com  ' }).email, '')
  assert.equal(supplierFormErrors({ code: 'SUP-1', name: 'Supplier', email: 'not-an-email' }).email, 'Enter a valid email address.')
})
