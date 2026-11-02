import assert from 'node:assert/strict'
import { test } from 'node:test'
import { customerFormErrors, customerFormFrom, customerPatch } from './customer-edit'

const base = customerFormFrom({ name: '=1+1', email: 't19-test@example.com', phone: null, paymentTermsDays: 30 })

test('form starts from the saved customer, with blanks for missing values', () => {
  assert.equal(base.name, '=1+1')
  assert.equal(base.phone, '')
  assert.equal(base.paymentTermsDays, '30')
  assert.equal(customerFormFrom({ name: 'x' }).paymentTermsDays, '0')
})

test('name is required, email and payment terms are checked', () => {
  assert.deepEqual(customerFormErrors(base), {})
  const bad = { ...base, name: '  ', email: 'nope', paymentTermsDays: '2.5' }
  assert.deepEqual(Object.keys(customerFormErrors(bad)).sort(), ['email', 'name', 'paymentTermsDays'])
  assert.ok(customerFormErrors({ ...base, paymentTermsDays: '400' }).paymentTermsDays)
})

test('only changed fields are sent, trimmed, and cleared ones as null', () => {
  const next = { ...base, name: ' Acme Corp ', email: '', phone: ' 555-0100 ' }
  assert.deepEqual(customerPatch(base, next), { name: 'Acme Corp', email: null, phone: '555-0100' })
  assert.deepEqual(customerPatch(base, { ...base, paymentTermsDays: '45' }), { paymentTermsDays: 45 })
  assert.deepEqual(customerPatch(base, { ...base, name: '=1+1 ' }), {})
})
