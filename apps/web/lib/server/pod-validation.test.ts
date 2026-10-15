import assert from 'node:assert/strict'
import test from 'node:test'
import { isSafePodImage, sanitizeProofOfDelivery } from './pod-validation'

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='

test('real photos and signatures are kept; unknown fields are dropped', () => {
  const pod = sanitizeProofOfDelivery({
    photoUrl: JPEG,
    signatureDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    notes: '  left at back door ',
    recipientName: 'Sam',
    ageConfirmed: true,
    deliveredAt: '2026-10-08T12:00:00Z',
    isAdmin: true,
    __proto__: { polluted: true },
  })
  assert.equal(pod.photoUrl, JPEG)
  assert.equal(pod.notes, 'left at back door')
  assert.equal(pod.ageConfirmed, true)
  assert.equal(pod.deliveredAt, '2026-10-08T12:00:00.000Z')
  assert.deepEqual(Object.keys(pod).sort(), [
    'ageConfirmed', 'deliveredAt', 'notes', 'photoUrl', 'recipientName', 'signatureDataUrl',
  ])
})

test('anything that could run as script is refused as an image', () => {
  for (const evil of [
    'javascript:alert(document.cookie)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'http://insecure.example/photo.jpg',
    'vbscript:msgbox(1)',
  ]) {
    assert.throws(() => sanitizeProofOfDelivery({ photoUrl: evil }), { status: 400 }, evil)
    assert.equal(isSafePodImage(evil), false, evil)
  }
  assert.equal(isSafePodImage('https://cdn.example.com/p.jpg'), true)
})

test('oversized images and text are rejected', () => {
  const huge = `data:image/jpeg;base64,${'A'.repeat(3_000_001)}`
  assert.throws(() => sanitizeProofOfDelivery({ photoUrl: huge }), { status: 413 })
  assert.throws(() => sanitizeProofOfDelivery({ notes: 'x'.repeat(2001) }), { status: 400 })
  assert.throws(() => sanitizeProofOfDelivery({ deliveredAt: 'not a date' }), { status: 400 })
})
