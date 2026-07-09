import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { isDevAutoVerifyEnabled } from './auth'

const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  SENDGRID: process.env.SENDGRID_API_KEY,
  FLAG: process.env.PLEROS_DEV_AUTO_VERIFY,
}

afterEach(() => {
  if (ORIGINAL.NODE_ENV === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = ORIGINAL.NODE_ENV
  if (ORIGINAL.SENDGRID === undefined) delete process.env.SENDGRID_API_KEY
  else process.env.SENDGRID_API_KEY = ORIGINAL.SENDGRID
  if (ORIGINAL.FLAG === undefined) delete process.env.PLEROS_DEV_AUTO_VERIFY
  else process.env.PLEROS_DEV_AUTO_VERIFY = ORIGINAL.FLAG
})

test('isDevAutoVerifyEnabled defaults on in non-production without SendGrid', () => {
  process.env.NODE_ENV = 'development'
  delete process.env.SENDGRID_API_KEY
  delete process.env.PLEROS_DEV_AUTO_VERIFY
  assert.equal(isDevAutoVerifyEnabled(), true)
})

test('isDevAutoVerifyEnabled is off in production', () => {
  process.env.NODE_ENV = 'production'
  delete process.env.SENDGRID_API_KEY
  delete process.env.PLEROS_DEV_AUTO_VERIFY
  assert.equal(isDevAutoVerifyEnabled(), false)
})

test('isDevAutoVerifyEnabled respects explicit 0 even without SendGrid', () => {
  process.env.NODE_ENV = 'development'
  delete process.env.SENDGRID_API_KEY
  process.env.PLEROS_DEV_AUTO_VERIFY = '0'
  assert.equal(isDevAutoVerifyEnabled(), false)
})

test('isDevAutoVerifyEnabled is off when SendGrid is configured', () => {
  process.env.NODE_ENV = 'development'
  process.env.SENDGRID_API_KEY = 'SG.fake'
  delete process.env.PLEROS_DEV_AUTO_VERIFY
  assert.equal(isDevAutoVerifyEnabled(), false)
})
