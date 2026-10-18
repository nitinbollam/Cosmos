import assert from 'node:assert/strict'
import test from 'node:test'
import { fireAndForget, fireAndForgetFailures, resetFireAndForgetFailures } from './fire-and-forget'

const tick = () => new Promise((r) => setTimeout(r, 5))

test('a rejected promise is logged with its context, counted, and never thrown', async () => {
  resetFireAndForgetFailures()
  const logged: unknown[][] = []
  const original = console.error
  console.error = (...a: unknown[]) => void logged.push(a)
  try {
    fireAndForget('notify.order_created', Promise.reject(new Error('smtp down')), { tenantId: 't1', orderId: 'o1', correlationId: 'c1' })
    await tick()
  } finally {
    console.error = original
  }
  assert.equal(fireAndForgetFailures()['notify.order_created'], 1)
  const line = String(logged[0][0])
  assert.match(line, /notify\.order_created/)
  assert.match(line, /tenant=t1 order=o1 correlation=c1/)
  assert.ok(logged.some((l) => String(l[0]).includes('[metric] fire_and_forget_failed')))
})

test('a function that throws synchronously is contained too', async () => {
  resetFireAndForgetFailures()
  const original = console.error
  console.error = () => undefined
  try {
    fireAndForget('sync.throw', () => {
      throw new Error('boom')
    })
    await tick()
  } finally {
    console.error = original
  }
  assert.equal(fireAndForgetFailures()['sync.throw'], 1)
})

test('success logs and counts nothing', async () => {
  resetFireAndForgetFailures()
  fireAndForget('ok', Promise.resolve(1))
  fireAndForget('ok.fn', async () => 2)
  await tick()
  assert.deepEqual(fireAndForgetFailures(), {})
})

test('warn level uses console.warn for the message', async () => {
  resetFireAndForgetFailures()
  const warns: unknown[][] = []
  const w = console.warn
  const e = console.error
  console.warn = (...a: unknown[]) => void warns.push(a)
  console.error = () => undefined
  try {
    fireAndForget('cleanup', Promise.reject(new Error('gone')), { level: 'warn' })
    await tick()
  } finally {
    console.warn = w
    console.error = e
  }
  assert.equal(warns.length, 1)
})
