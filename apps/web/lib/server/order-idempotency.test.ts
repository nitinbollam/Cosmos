import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { placeOrderOnce } from './routes/sales-orders'

const session = { tenantId: `t-${randomUUID()}`, userId: 'buyer-1' }

function post(key?: string) {
  return new Request('http://localhost/api/v1/orders', {
    method: 'POST',
    headers: key ? { 'idempotency-key': key } : {},
  })
}

test('a retried checkout returns the first order instead of placing a second', async () => {
  let created = 0
  const create = async () => ({ id: `order-${++created}`, total: 10 })
  const key = randomUUID()

  const first = await placeOrderOnce(post(key), session, create)
  const retry = await placeOrderOnce(post(key), session, create)
  assert.equal(first.status, 201)
  assert.equal(retry.status, 201)
  assert.deepEqual(await retry.json(), { id: 'order-1', total: 10 })
  assert.equal(created, 1)
})

test('two identical requests at the same moment place one order', async () => {
  let created = 0
  const create = async () => {
    await new Promise((r) => setTimeout(r, 30))
    return { id: `order-${++created}` }
  }
  const key = randomUUID()
  const results = await Promise.allSettled([
    placeOrderOnce(post(key), session, create),
    placeOrderOnce(post(key), session, create),
  ])
  assert.equal(created, 1)
  const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  assert.equal(rejected.length, 1)
  assert.equal((rejected[0]!.reason as { status: number }).status, 409)
})

test('a failed attempt frees the key so the buyer can try again', async () => {
  const key = randomUUID()
  await assert.rejects(
    placeOrderOnce(post(key), session, async () => {
      throw Object.assign(new Error('price changed'), { status: 400 })
    }),
  )
  const ok = await placeOrderOnce(post(key), session, async () => ({ id: 'order-ok' }))
  assert.equal(ok.status, 201)
})

test('without a key each request places its own order (unchanged behaviour)', async () => {
  let created = 0
  const create = async () => ({ id: `order-${++created}` })
  await placeOrderOnce(post(), session, create)
  await placeOrderOnce(post(), session, create)
  assert.equal(created, 2)
})
