import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_FAILURE_REASON_LENGTH,
  failureFromPod,
  failureReasonProblem,
  isRouteFinished,
  normalizeFailureReason,
  podForDelivery,
  podWithFailure,
} from './stop-outcome'

const FAILURE = { reason: 'Business closed', failedAt: '2026-10-06T18:00:00.000Z', failedBy: 'usr_driver' }

test('failureReasonProblem requires a reason and caps its length', () => {
  assert.match(failureReasonProblem(undefined) ?? '', /reason is required/)
  assert.match(failureReasonProblem('   ') ?? '', /reason is required/)
  assert.match(failureReasonProblem(42) ?? '', /reason is required/)
  assert.match(failureReasonProblem('x'.repeat(MAX_FAILURE_REASON_LENGTH + 1)) ?? '', /or fewer/)
  assert.equal(failureReasonProblem('  Nobody there  '), null)
  assert.equal(normalizeFailureReason('  Nobody there  '), 'Nobody there')
})

test('podWithFailure records the failure and keeps what was already there', () => {
  assert.deepEqual(podWithFailure(null, FAILURE), { failure: FAILURE })
  assert.deepEqual(podWithFailure({ notes: 'gate 4' }, FAILURE), { notes: 'gate 4', failure: FAILURE })
})

test('failureFromPod reads a recorded failure and ignores anything malformed', () => {
  assert.deepEqual(failureFromPod({ failure: FAILURE }), FAILURE)
  assert.equal(failureFromPod(null), null)
  assert.equal(failureFromPod({ photoUrl: 'data:image/jpeg;base64,AAAA' }), null)
  assert.equal(failureFromPod({ failure: { reason: 'no timestamp' } }), null)
})

test('podForDelivery keeps an earlier failure when the stop is redelivered', () => {
  const evidence = { photoUrl: 'data:image/jpeg;base64,AAAA', signatureDataUrl: 'data:image/png;base64,BBBB' }
  assert.deepEqual(podForDelivery({ failure: FAILURE }, evidence), { ...evidence, failure: FAILURE })
  assert.deepEqual(podForDelivery(null, evidence), evidence)
})

test('podForDelivery drops a failure entry sent by the client', () => {
  const forged = { photoUrl: 'data:image/jpeg;base64,AAAA', failure: { reason: 'forged', failedAt: 'x' } }
  assert.deepEqual(podForDelivery(null, forged), { photoUrl: 'data:image/jpeg;base64,AAAA' })
})

test('isRouteFinished once every stop is delivered or failed', () => {
  assert.equal(isRouteFinished(['DELIVERED', 'DELIVERED']), true)
  assert.equal(isRouteFinished(['DELIVERED', 'FAILED']), true)
  assert.equal(isRouteFinished(['FAILED']), true)
  assert.equal(isRouteFinished(['DELIVERED', 'PENDING']), false)
  assert.equal(isRouteFinished(['FAILED', 'EN_ROUTE']), false)
  assert.equal(isRouteFinished([]), false)
})
