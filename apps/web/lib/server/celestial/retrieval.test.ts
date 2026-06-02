import test from 'node:test'
import assert from 'node:assert/strict'
import { clearRetrievalCache, getDocChunkCount, retrievePlatformDocs } from './retrieval'

test('retrievePlatformDocs loads celestial knowledge base', () => {
  clearRetrievalCache()
  assert.ok(getDocChunkCount() > 20, `expected many chunks, got ${getDocChunkCount()}`)
})

test('retrievePlatformDocs finds architecture content', () => {
  clearRetrievalCache()
  const chunks = retrievePlatformDocs('architecture API backend')
  assert.ok(chunks.length > 0)
  assert.ok(chunks.some((c) => c.heading.toLowerCase().includes('architecture') || c.body.toLowerCase().includes('api')))
})

test('retrievePlatformDocs finds POS content', () => {
  clearRetrievalCache()
  const chunks = retrievePlatformDocs('How POS works in cosmos?')
  assert.ok(chunks.length > 0)
  assert.ok(chunks.some((c) => c.body.toLowerCase().includes('pos')))
})

test('retrievePlatformDocs finds FAQ for demo login', () => {
  clearRetrievalCache()
  const chunks = retrievePlatformDocs('demo login password admin')
  assert.ok(chunks.some((c) => c.body.includes('admin@cosmos.local')))
})

test('retrievePlatformDocs finds warehouse content', () => {
  clearRetrievalCache()
  const chunks = retrievePlatformDocs('what warehouses do we have')
  assert.ok(chunks.some((c) => /warehouse/i.test(c.heading + c.body)))
})

test('retrievePlatformDocs finds Celestial documentation', () => {
  clearRetrievalCache()
  const chunks = retrievePlatformDocs('how does Celestial AI work')
  assert.ok(chunks.some((c) => /celestial/i.test(c.heading + c.body)))
})
