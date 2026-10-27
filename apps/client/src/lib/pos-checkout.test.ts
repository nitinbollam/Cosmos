import assert from 'node:assert/strict'
import test from 'node:test'
import { cashDue, cashShortfall, changeDue, checkoutBlocker, nextRegisterName, sortRegisters, type CheckoutState } from './pos-checkout'

const base = { total: 24.99, method: 'CASH' as const, split: false, secondMethod: 'CARD' as const, secondAmount: '' }

test('a cash sale owes the whole total in cash; other methods owe none', () => {
  assert.equal(cashDue(base), 24.99)
  assert.equal(cashDue({ ...base, method: 'CARD' }), 0)
})

test('split tenders count only their cash leg', () => {
  assert.equal(cashDue({ ...base, split: true, secondAmount: '10' }), 14.99)
  assert.equal(cashDue({ ...base, method: 'CARD', split: true, secondMethod: 'CASH', secondAmount: '10' }), 10)
  assert.equal(cashDue({ ...base, method: 'CARD', split: true, secondMethod: 'CARD', secondAmount: '10' }), 0)
  assert.equal(cashDue({ ...base, split: true, secondAmount: '' }), 24.99)
})

test('change due is received minus due, to the cent, never negative', () => {
  assert.equal(changeDue('30', 24.99), 5.01)
  assert.equal(changeDue('24.99', 24.99), 0)
  assert.equal(changeDue('20', 24.99), 0)
  assert.equal(changeDue('', 24.99), null)
  assert.equal(changeDue('abc', 24.99), null)
})

test('a sale cannot complete with less cash than is due', () => {
  assert.equal(cashShortfall('', 24.99), 24.99)
  assert.equal(cashShortfall('20', 24.99), 4.99)
  assert.equal(cashShortfall('24.99', 24.99), null)
  assert.equal(cashShortfall('50', 24.99), null)
  assert.equal(cashShortfall('', 0), null)
})

test('the next register name follows the highest number, in any creation order', () => {
  assert.equal(nextRegisterName([]), 'Register 1')
  assert.equal(nextRegisterName(['Register 2', 'Register 10', 'Register 4']), 'Register 11')
  assert.equal(nextRegisterName(['Front till', 'Register 3']), 'Register 4')
})

test('registers sort naturally: 2 before 10', () => {
  const names = sortRegisters([{ name: 'Register 10' }, { name: 'Register 2' }, { name: 'Register 1' }]).map((r) => r.name)
  assert.deepEqual(names, ['Register 1', 'Register 2', 'Register 10'])
})

const ok: CheckoutState = {
  hasShift: true,
  hasOpenTill: true,
  hasRegister: true,
  hasWarehouse: true,
  hasCustomer: true,
  cartCount: 1,
  discountPending: false,
  needsIdScan: false,
  splitIncomplete: false,
  secondMax: 24.98,
  cashRequired: 0,
  cashReceived: '',
}

test('a ready sale has no blocker', () => {
  assert.equal(checkoutBlocker(ok), null)
})

test('each reason is reported, in the order a cashier would fix them', () => {
  assert.match(checkoutBlocker({ ...ok, hasShift: false })!, /Clock in/)
  assert.match(checkoutBlocker({ ...ok, hasOpenTill: false })!, /Open the till/)
  assert.match(checkoutBlocker({ ...ok, hasRegister: false })!, /register/i)
  assert.match(checkoutBlocker({ ...ok, cartCount: 0 })!, /Add at least one item/)
  assert.match(checkoutBlocker({ ...ok, needsIdScan: true })!, /Scan/)
  assert.match(checkoutBlocker({ ...ok, splitIncomplete: true })!, /second payment/)
  assert.match(checkoutBlocker({ ...ok, cashRequired: 24.99 })!, /Enter the cash received/)
  assert.match(checkoutBlocker({ ...ok, cashRequired: 24.99, cashReceived: '20' })!, /\$4\.99 short/)
  assert.equal(checkoutBlocker({ ...ok, cashRequired: 24.99, cashReceived: '30' }), null)
  assert.match(checkoutBlocker({ ...ok, hasShift: false, cartCount: 0 })!, /Clock in/)
})
