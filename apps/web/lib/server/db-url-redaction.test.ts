import assert from 'node:assert/strict'
import test from 'node:test'
import { redactDatabaseUrl } from '../../../../scripts/db-urls.mjs'

test('a Postgres URL keeps host and database but loses the password', () => {
  assert.equal(
    redactDatabaseUrl('postgresql://postgres:s3cr3t-Pa55@postgres.railway.internal:5432/pleros_auth'),
    'postgresql://postgres:***@postgres.railway.internal:5432/pleros_auth',
  )
  assert.equal(redactDatabaseUrl('postgresql://u:p%40ss@db:5432/x?sslmode=require'), 'postgresql://u:***@db:5432/x?sslmode=require')
})

test('URLs without a password are unchanged', () => {
  assert.equal(redactDatabaseUrl('file:/app/.data/pleros_auth.db'), 'file:/app/.data/pleros_auth.db')
  assert.equal(redactDatabaseUrl('postgresql://postgres@db:5432/x'), 'postgresql://postgres@db:5432/x')
})

test('an unparseable string still has its password hidden', () => {
  assert.equal(redactDatabaseUrl('not a url //user:secret@host'), 'not a url //user:***@host')
})
