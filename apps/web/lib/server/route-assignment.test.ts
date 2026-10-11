import assert from 'node:assert/strict'
import test from 'node:test'
import { statusAfterAssign, statusAfterOutcome, unassignDriverProblem } from './route-assignment'

const pending = [{ status: 'PENDING' }, { status: 'EN_ROUTE' }]

test('unassignDriverProblem allows unassigning before any stop has an outcome', () => {
  assert.equal(unassignDriverProblem({ status: 'IN_PROGRESS', driverId: 'usr_dan', stops: pending }), null)
  assert.equal(unassignDriverProblem({ status: 'PLANNED', driverId: null, stops: pending }), null)
  assert.equal(unassignDriverProblem({ status: 'ASSIGNED', driverId: 'usr_dan', stops: pending }), null)
  assert.equal(unassignDriverProblem({ status: 'IN_PROGRESS', driverId: 'usr_dan', stops: [] }), null)
})

test('unassignDriverProblem refuses once a stop is delivered or failed', () => {
  for (const done of ['DELIVERED', 'FAILED']) {
    const problem = unassignDriverProblem({ status: 'IN_PROGRESS', driverId: 'usr_dan', stops: [{ status: done }, ...pending] })
    assert.equal(problem?.status, 409)
    assert.match(problem?.message ?? '', /assign another driver/)
  }
})

test('unassignDriverProblem refuses completed and cancelled routes', () => {
  for (const status of ['COMPLETED', 'CANCELLED']) {
    assert.equal(unassignDriverProblem({ status, driverId: 'usr_dan', stops: pending })?.status, 409)
  }
})

test('statusAfterAssign: ASSIGNED until work starts; a route under way stays IN_PROGRESS', () => {
  assert.equal(statusAfterAssign('PLANNED'), 'ASSIGNED')
  assert.equal(statusAfterAssign('ASSIGNED'), 'ASSIGNED')
  assert.equal(statusAfterAssign('IN_PROGRESS'), 'IN_PROGRESS')
})

test('statusAfterOutcome: first outcome starts the route; all outcomes complete it', () => {
  assert.equal(statusAfterOutcome('ASSIGNED', ['DELIVERED', 'PENDING']), 'IN_PROGRESS')
  assert.equal(statusAfterOutcome('ASSIGNED', ['FAILED', 'PENDING']), 'IN_PROGRESS')
  assert.equal(statusAfterOutcome('IN_PROGRESS', ['DELIVERED', 'PENDING']), 'IN_PROGRESS')
  assert.equal(statusAfterOutcome('ASSIGNED', ['DELIVERED', 'FAILED']), 'COMPLETED')
  assert.equal(statusAfterOutcome('PLANNED', ['FAILED', 'PENDING']), 'PLANNED')
})
