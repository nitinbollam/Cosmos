import assert from 'node:assert/strict'
import test from 'node:test'
import { availableCredit, canSeeAccount, canWorkLead, creditRequestProblem, leadIsOpen, repLinesProblem } from './rep-rules'

test('reps see their own accounts, managers see all', () => {
  assert.equal(canSeeAccount({ userId: 'r1', role: 'SALES_REP' }, 'r1'), true)
  assert.equal(canSeeAccount({ userId: 'r1', role: 'SALES_REP' }, 'r2'), false)
  assert.equal(canSeeAccount({ userId: 'r1', role: 'SALES_REP' }, null), false)
  assert.equal(canSeeAccount({ userId: 'm', role: 'MANAGER' }, 'r2'), true)
  assert.equal(canSeeAccount({ userId: 'a', role: 'TENANT_ADMIN' }, null), true)
})

test('available credit', () => {
  assert.equal(availableCredit(null, 50), null)
  assert.equal(availableCredit(0, 50), null)
  assert.equal(availableCredit(1000, 250.5), 749.5)
  assert.equal(availableCredit(1000, 1200), -200)
})

test('credit requests need a real increase and a reason', () => {
  assert.equal(creditRequestProblem({ requestedLimit: 5000, reason: 'Adding a second store' }, 2000), null)
  assert.equal(creditRequestProblem({ requestedLimit: 5000, reason: 'Opening a new store' }, null), null)
  assert.match(creditRequestProblem({ requestedLimit: 2000, reason: 'Adding a second store' }, 2000)!, /above the current/)
  assert.match(creditRequestProblem({ requestedLimit: 1000, reason: 'Adding a second store' }, 2000)!, /above the current/)
  assert.match(creditRequestProblem({ requestedLimit: 'abc', reason: 'x'.repeat(10) }, null)!, /limit you are asking/)
  assert.match(creditRequestProblem({ requestedLimit: -5, reason: 'x'.repeat(10) }, null)!, /limit you are asking/)
  assert.match(creditRequestProblem({ requestedLimit: 5000, reason: ' ok ' }, 100)!, /why/)
  assert.match(creditRequestProblem({ requestedLimit: 5000 }, 100)!, /why/)
  assert.match(creditRequestProblem({ requestedLimit: 5000.123, reason: 'Adding a second store' }, 100)!, /cents/)
})

test('order and quote lines', () => {
  assert.equal(repLinesProblem([{ skuId: 'a', quantity: 2 }, { skuId: 'b', quantity: 1 }]), null)
  assert.match(repLinesProblem([])!, /at least one/)
  assert.match(repLinesProblem('x')!, /at least one/)
  assert.match(repLinesProblem([{ quantity: 1 }])!, /item/)
  assert.match(repLinesProblem([{ skuId: 'a', quantity: 0 }])!, /whole number/)
  assert.match(repLinesProblem([{ skuId: 'a', quantity: 1.5 }])!, /whole number/)
  assert.match(repLinesProblem([{ skuId: 'a', quantity: 1 }, { skuId: 'a', quantity: 2 }])!, /combine/)
})

test('leads', () => {
  assert.equal(leadIsOpen('NEW'), true)
  assert.equal(leadIsOpen('WON'), false)
  assert.equal(leadIsOpen('LOST'), false)
  assert.equal(canWorkLead({ userId: 'r1', role: 'SALES_REP' }, null), true)
  assert.equal(canWorkLead({ userId: 'r1', role: 'SALES_REP' }, 'r1'), true)
  assert.equal(canWorkLead({ userId: 'r1', role: 'SALES_REP' }, 'r2'), false)
  assert.equal(canWorkLead({ userId: 'm', role: 'MANAGER' }, 'r2'), true)
})
