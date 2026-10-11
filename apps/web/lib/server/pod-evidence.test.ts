import assert from 'node:assert/strict'
import test from 'node:test'
import { podEvidenceProblem } from './pod-evidence'

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo='

test('podEvidenceProblem accepts a photo and a signature', () => {
  assert.equal(podEvidenceProblem({ photoUrl: PHOTO, signatureDataUrl: SIGNATURE, notes: 'left at dock' }), null)
})

test('podEvidenceProblem rejects an empty POD (the old admin "Mark delivered" body)', () => {
  assert.match(podEvidenceProblem({}) ?? '', /photo and the recipient signature are required/)
  assert.match(podEvidenceProblem(undefined) ?? '', /photo and the recipient signature are required/)
  assert.match(podEvidenceProblem({ photoUrl: null, signatureDataUrl: '  ' }) ?? '', /are required/)
})

test('podEvidenceProblem requires each piece of evidence', () => {
  assert.equal(podEvidenceProblem({ signatureDataUrl: SIGNATURE }), 'A delivery photo is required')
  assert.equal(podEvidenceProblem({ photoUrl: PHOTO }), 'The recipient signature is required')
})

test('podEvidenceProblem rejects values that are not images', () => {
  assert.match(
    podEvidenceProblem({ photoUrl: 'https://example.com/a.jpg', signatureDataUrl: SIGNATURE }) ?? '',
    /photo must be/,
  )
  assert.match(podEvidenceProblem({ photoUrl: 'data:image/jpeg;base64,', signatureDataUrl: SIGNATURE }) ?? '', /photo must be/)
  assert.match(podEvidenceProblem({ photoUrl: PHOTO, signatureDataUrl: 'data:text/html;base64,PGI+' }) ?? '', /signature must be/)
  assert.match(podEvidenceProblem({ photoUrl: PHOTO, signatureDataUrl: 'signed' }) ?? '', /signature must be/)
})
