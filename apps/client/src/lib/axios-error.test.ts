import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AxiosError, AxiosHeaders } from 'axios'
import { shouldRetryQuery } from './axios-error'

function httpError(status?: number) {
  const err = new AxiosError('failed')
  if (status !== undefined) {
    err.response = { status, statusText: '', data: {}, headers: {}, config: { headers: new AxiosHeaders() } }
  }
  return err
}

test('server and client errors are not retried', () => {
  for (const status of [400, 401, 403, 404, 409, 500, 503]) {
    assert.equal(shouldRetryQuery(0, httpError(status)), false, String(status))
  }
})

test('network failures and gateway timeouts are retried at most twice', () => {
  for (const err of [httpError(), httpError(502), httpError(504)]) {
    assert.equal(shouldRetryQuery(0, err), true)
    assert.equal(shouldRetryQuery(1, err), true)
    assert.equal(shouldRetryQuery(2, err), false)
  }
})

test('non-HTTP errors are not retried', () => {
  assert.equal(shouldRetryQuery(0, new Error('bad json')), false)
})
