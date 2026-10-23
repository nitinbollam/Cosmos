import assert from 'node:assert/strict'
import test from 'node:test'
import { derivePickLineStatus } from './pick-line-status'

test('derivePickLineStatus returns PENDING when nothing picked', () => {
  assert.equal(derivePickLineStatus(10, 0), 'PENDING')
})

test('derivePickLineStatus returns PICKED when fully picked', () => {
  assert.equal(derivePickLineStatus(10, 10), 'PICKED')
  assert.equal(derivePickLineStatus(10, 12), 'PICKED')
})

test('derivePickLineStatus returns SHORT when partial with markShort', () => {
  assert.equal(derivePickLineStatus(10, 7, true), 'SHORT')
})

test('derivePickLineStatus returns PENDING for partial without markShort', () => {
  assert.equal(derivePickLineStatus(10, 7), 'PENDING')
})

test('derivePickLineStatus returns SHORT when nothing could be found and the picker marks it short', () => {
  assert.equal(derivePickLineStatus(10, 0, true), 'SHORT')
  assert.equal(derivePickLineStatus(10, 0, false), 'PENDING')
})
