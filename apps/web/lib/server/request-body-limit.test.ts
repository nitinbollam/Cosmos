import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_BODY_LIMIT_BYTES, LARGE_BODY_LIMIT_BYTES, maxRequestBodyBytes } from './request-body-limit'

test('ordinary requests get the 2 MB default', () => {
  for (const [method, path] of [
    ['POST', '/api/v1/orders'],
    ['POST', '/api/v1/auth/login'],
    ['PATCH', '/api/v1/tenants/me'],
    ['POST', '/api/v1/webhooks/stripe'],
    ['GET', '/api/v1/dispatch/stops/s1/pod'], // the large limit is for uploads (POST) only
    ['POST', '/api/v1/dispatch/stops/s1/pod/extra'],
    ['POST', '/api/v1/customers/import-anything'],
  ]) {
    assert.equal(maxRequestBodyBytes(method, path), DEFAULT_BODY_LIMIT_BYTES, `${method} ${path}`)
  }
  assert.equal(DEFAULT_BODY_LIMIT_BYTES, 2 * 1024 * 1024)
})

test('file and bulk-import routes get 8 MB', () => {
  for (const path of [
    '/api/v1/dispatch/stops/s1/pod',
    '/api/v1/marketplace/uploads',
    '/api/v1/expense-reports/receipts',
    '/api/v1/customers/import',
    '/api/v1/leads/import',
    '/api/v1/skus/import',
    '/api/v1/bank-accounts/b1/import',
    '/api/v1/wms/receiving/r1/import',
    '/api/v1/wms/receiving/sessions/r1/import',
    '/api/v1/wms/cycle-counts/c1/lines/import',
    '/api/v1/msa/transactions/import',
    '/api/v1/dispatch/stops/s1/pod/', // trailing slash
  ]) {
    assert.equal(maxRequestBodyBytes('POST', path), LARGE_BODY_LIMIT_BYTES, path)
  }
  assert.equal(LARGE_BODY_LIMIT_BYTES, 8 * 1024 * 1024)
})
