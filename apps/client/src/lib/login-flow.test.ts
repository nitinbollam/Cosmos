import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tenantPromptOf, tokensOf } from './login-flow'

const tokens = { accessToken: 'a', refreshToken: 'r' }
const prompt = {
  requiresTenantSelection: true as const,
  selectionToken: 'sel',
  tenants: [{ id: 't1', slug: 'acme', name: 'Acme' }],
}

test('a normal sign-in response has tokens and no company prompt', () => {
  assert.equal(tenantPromptOf(tokens), null)
  assert.deepEqual(tokensOf(tokens), tokens)
})

test('a company prompt exposes the token and companies, never tokens', () => {
  assert.deepEqual(tenantPromptOf(prompt), { selectionToken: 'sel', tenants: prompt.tenants })
  assert.throws(() => tokensOf(prompt), /company choice/)
})
