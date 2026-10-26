import test from 'node:test'
import assert from 'node:assert/strict'
import { approvedCelestialLinks, isApprovedCelestialHref } from './celestial-links'

test('internal Pleros screens are allowed', () => {
  for (const href of ['/admin', '/admin/orders/abc', '/admin/settings?tab=warehouses', '/catalog', '/quotes/q1', '/m/warehouse']) {
    assert.equal(isApprovedCelestialHref(href), true, href)
  }
})

test('external, scheme and traversal links are refused', () => {
  for (const href of [
    'https://evil.example',
    '//evil.example/admin',
    'javascript:alert(1)',
    'data:text/html,hi',
    '/admin/../api/v1/secrets',
    '/admin/%2e%2e/x',
    '/\\evil.example',
    '/api/v1/celestial/status',
    '/administrator',
    '',
    undefined,
  ]) {
    assert.equal(isApprovedCelestialHref(href), false, String(href))
  }
})

test('approvedCelestialLinks filters link chips', () => {
  const links = approvedCelestialLinks([
    { label: 'ok', href: '/admin/orders' },
    { label: 'bad', href: 'https://x.example' },
  ])
  assert.deepEqual(links.map((l) => l.label), ['ok'])
})
