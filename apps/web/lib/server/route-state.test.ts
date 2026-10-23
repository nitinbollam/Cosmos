import assert from 'node:assert/strict'
import test from 'node:test'
import { checkRouteStates, stopState } from './route-state'

test('a stop is in the state of its address, else of its customer', () => {
  assert.equal(stopState({ state: 'fl' }, 'GA'), 'FL')
  assert.equal(stopState({ stateCode: ' ga ' }, null), 'GA')
  assert.equal(stopState({ region: 'AL' }), 'AL')
  assert.equal(stopState({ line1: '1 Main St' }, 'tn'), 'TN')
  assert.equal(stopState({ state: 'Florida' }, 'GA'), 'GA', 'a full state name is not a code, so it falls back')
  assert.equal(stopState(null, null), null)
  assert.equal(stopState([], 'FL'), 'FL')
})

test('one state, or unknowns beside one state, is fine', () => {
  assert.deepEqual(checkRouteStates(['FL', 'FL']), { state: 'FL', unknownStops: 0, problem: null })
  assert.deepEqual(checkRouteStates(['FL', null, 'FL']), { state: 'FL', unknownStops: 1, problem: null })
  assert.deepEqual(checkRouteStates([null, null]), { state: null, unknownStops: 2, problem: null })
  assert.deepEqual(checkRouteStates([]), { state: null, unknownStops: 0, problem: null })
})

test('two states are refused, naming them', () => {
  const r = checkRouteStates(['GA', 'FL', 'FL', null])
  assert.equal(r.state, null)
  assert.equal(r.unknownStops, 1)
  assert.match(r.problem!, /FL, GA/)
  assert.match(r.problem!, /one state/)
})
