import test from 'node:test'
import assert from 'node:assert/strict'
import { retrievePlatformDocs } from './retrieval'

test('retrievePlatformDocs finds architecture content', () => {
  const chunks = retrievePlatformDocs('architecture API backend')
  assert.ok(chunks.length > 0)
  assert.ok(chunks.some((c) => c.heading.toLowerCase().includes('architecture') || c.body.toLowerCase().includes('api')))
})
