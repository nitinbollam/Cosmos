import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isDatabaseUnavailableError } from './db-health'
import { ApiError, toJsonError } from './session'

test('missing or unreachable databases are recognised', () => {
  const init = Object.assign(new Error("Can't reach database server"), { name: 'PrismaClientInitializationError', errorCode: 'P1001' })
  assert.equal(isDatabaseUnavailableError(init), true)
  assert.equal(isDatabaseUnavailableError({ code: 'P1003' }), true)
  assert.equal(isDatabaseUnavailableError({ code: 'P2021' }), true)
  assert.equal(isDatabaseUnavailableError({ code: 'P2002' }), false)
  assert.equal(isDatabaseUnavailableError(new Error('boom')), false)
})

test('a database that is not set up returns 503 with a meaningful message', async () => {
  const original = console.error
  console.error = () => {}
  try {
    const res = toJsonError({ code: 'P1003', message: 'Database `pleros_sales_channels` does not exist' })
    assert.equal(res.status, 503)
    const body = (await res.json()) as { message: string }
    assert.match(body.message, /database is not set up/)
    assert.doesNotMatch(body.message, /pleros_sales_channels/)
  } finally {
    console.error = original
  }
})

test('other errors keep their status', () => {
  assert.equal(toJsonError(new ApiError(404, 'nope')).status, 404)
  const original = console.error
  console.error = () => {}
  try {
    assert.equal(toJsonError(new Error('boom')).status, 500)
  } finally {
    console.error = original
  }
})
