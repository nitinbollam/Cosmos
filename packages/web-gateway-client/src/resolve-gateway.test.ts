import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_GATEWAY_PATH, resolveGatewayBaseUrl } from './index'

test('resolveGatewayBaseUrl prefers explicit override', () => {
  assert.equal(resolveGatewayBaseUrl('https://api.example/v1'), 'https://api.example/v1')
})

test('resolveGatewayBaseUrl falls back to default path', () => {
  assert.equal(resolveGatewayBaseUrl(), DEFAULT_GATEWAY_PATH)
})
