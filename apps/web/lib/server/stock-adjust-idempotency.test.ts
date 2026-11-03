import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, inventoryDb, orderDb, tenantDb } from './db'
import { adjustStock, postStockAdjustment } from './inventory'

// SQLite serialises writers and times out a deep queue of interactive transactions, so local runs
// use fewer; Postgres (the real race) runs more.
const N = process.env.PLEROS_DB_PROVIDER === 'postgres' ? 20 : 5

const tenants: string[] = []
const userIds: string[] = []

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await orderDb.postingJob.deleteMany({ where: { tenantId: { in: tenants } } })
  await tenantDb.webhookDelivery.deleteMany({ where: { tenantId: { in: tenants } } })
  await tenantDb.webhookSubscription.deleteMany({ where: { tenantId: { in: tenants } } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: { in: tenants } } })
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId: { in: tenants } } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId: { in: tenants } } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId: { in: tenants } } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId: { in: tenants } } })
  await authDb.tenant.deleteMany({ where: { id: { in: tenants } } })
})

async function seed(opts: { onHand?: number; reorderPoint?: number; skuId?: string; tenantId?: string } = {}) {
  const tenantId = opts.tenantId ?? `t-${randomUUID()}`
  if (!tenants.includes(tenantId)) tenants.push(tenantId)
  const skuId = opts.skuId ?? randomUUID()
  const warehouseId = randomUUID()
  const onHand = opts.onHand ?? 20
  await inventoryDb.sKU.create({
    data: { id: skuId, tenantId, code: `S-${skuId.slice(0, 6)}`, name: 'Pack', category: 'x', cost: 2, price: 10, imageUrls: [], attributes: {} },
  })
  await inventoryDb.warehouse.create({
    data: { id: warehouseId, tenantId, name: 'W', code: `W-${warehouseId.slice(0, 6)}`, address: {} },
  })
  await inventoryDb.stockLevel.create({
    data: {
      id: randomUUID(), tenantId, skuId, warehouseId, batchId: '',
      quantityOnHand: onHand, quantityReserved: 0, quantityAvailable: onHand, reorderPoint: opts.reorderPoint ?? 0,
    },
  })
  return { tenantId, skuId, warehouseId }
}

type Seed = Awaited<ReturnType<typeof seed>>

const level = (s: Seed) =>
  inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId: s.tenantId, skuId: s.skuId, warehouseId: s.warehouseId, batchId: '' } })
const ledgerRows = (s: Seed) => inventoryDb.stockLedgerEntry.findMany({ where: { tenantId: s.tenantId, skuId: s.skuId } })
const glJobs = (tenantId: string) => orderDb.postingJob.findMany({ where: { tenantId, sourceType: 'StockAdjustment' } })

function keyed(s: Seed, idempotencyKey: string, quantityDelta = -3) {
  return postStockAdjustment(
    s.tenantId,
    { skuId: s.skuId, warehouseId: s.warehouseId, quantityDelta, referenceType: 'CYCLE_COUNT', referenceId: 'count-1', ledger: true, idempotencyKey },
    'u',
  )
}

test('the first adjustment with a key changes stock once and stores the key on its ledger row', async () => {
  const s = await seed()
  const key = `cycle-count-line:${randomUUID()}`
  const r = await keyed(s, key)
  assert.equal(r.replayed, false)
  assert.equal(r.level.quantityOnHand, 17)
  const rows = await ledgerRows(s)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, r.ledgerEntryId)
  assert.equal(rows[0].idempotencyKey, key)
  assert.equal(rows[0].quantityDelta, -3)
  assert.equal((await glJobs(s.tenantId)).length, 1)
})

test('repeating the key changes nothing and returns the first ledger row', async () => {
  const s = await seed()
  const key = `cycle-count-line:${randomUUID()}`
  const first = await keyed(s, key)
  const again = await keyed(s, key)
  assert.equal(again.replayed, true)
  assert.equal(again.ledgerEntryId, first.ledgerEntryId)
  assert.equal(again.level.quantityOnHand, 17)
  assert.equal((await level(s)).quantityOnHand, 17)
  assert.equal((await level(s)).quantityAvailable, 17)
  assert.equal((await ledgerRows(s)).length, 1)
  // Same correlation id and variant, so the GL job is not queued a second time.
  const jobs = await glJobs(s.tenantId)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].sourceId, (await ledgerRows(s))[0].correlationId)
})

test('concurrent requests with one key change stock exactly once', async () => {
  const s = await seed({ onHand: 100 })
  const key = `cycle-count-line:${randomUUID()}`
  const results = await Promise.all(Array.from({ length: N }, () => keyed(s, key)))
  assert.equal(results.filter((r) => !r.replayed).length, 1)
  assert.equal(new Set(results.map((r) => r.ledgerEntryId)).size, 1)
  assert.equal((await level(s)).quantityOnHand, 97)
  assert.equal((await level(s)).quantityAvailable, 97)
  assert.equal((await ledgerRows(s)).length, 1)
  assert.equal((await glJobs(s.tenantId)).length, 1)
})

test('a unique-key conflict rolls the losing transaction back and replays the committed row', async () => {
  const s = await seed()
  const key = `cycle-count-line:${randomUUID()}`
  const first = await keyed(s, key)
  // Recreate what Postgres allows under READ COMMITTED: the check inside the transaction does not see the row
  // another request just committed, so this one updates stock and then fails on the unique index.
  type Run = (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>
  const client = inventoryDb as unknown as { $transaction: Run }
  const realTransaction = client.$transaction
  let blinded = 0
  client.$transaction = (fn) =>
    realTransaction.call(inventoryDb, (tx: unknown) => {
      const ledger = (tx as { stockLedgerEntry: object }).stockLedgerEntry
      const blindLedger = new Proxy(ledger, {
        get(target, prop) {
          if (prop === 'findFirst') {
            blinded++
            return async () => null
          }
          const v = Reflect.get(target, prop)
          return typeof v === 'function' ? v.bind(target) : v
        },
      })
      return fn(new Proxy(tx as object, { get: (target, prop) => (prop === 'stockLedgerEntry' ? blindLedger : Reflect.get(target, prop)) }))
    })
  let again: Awaited<ReturnType<typeof keyed>>
  try {
    again = await keyed(s, key)
  } finally {
    client.$transaction = realTransaction
  }
  assert.equal(blinded, 1, 'the in-transaction check was bypassed')
  assert.equal(again.replayed, true)
  assert.equal(again.ledgerEntryId, first.ledgerEntryId)
  // The losing transaction's stock change was rolled back with it.
  assert.equal((await level(s)).quantityOnHand, 17)
  assert.equal((await ledgerRows(s)).length, 1)
  assert.equal((await glJobs(s.tenantId)).length, 1)
})

test('the same key in two tenants posts in both', async () => {
  const a = await seed()
  const b = await seed()
  const key = `cycle-count-line:${randomUUID()}`
  assert.equal((await keyed(a, key)).replayed, false)
  assert.equal((await keyed(b, key)).replayed, false)
  assert.equal((await level(a)).quantityOnHand, 17)
  assert.equal((await level(b)).quantityOnHand, 17)
})

test('a key reused for a different change is refused and changes nothing', async () => {
  const s = await seed()
  const key = `cycle-count-line:${randomUUID()}`
  await keyed(s, key, -3)
  await assert.rejects(keyed(s, key, -5), (e: unknown) => (e as { status?: number }).status === 409)
  assert.equal((await level(s)).quantityOnHand, 17)
  assert.equal((await ledgerRows(s)).length, 1)
})

test('adjustments without a key behave as before: each one posts', async () => {
  const s = await seed()
  const dto = { skuId: s.skuId, warehouseId: s.warehouseId, quantityDelta: -2, ledger: true }
  const one = await adjustStock(s.tenantId, dto, 'u')
  const two = await adjustStock(s.tenantId, dto, 'u')
  // adjustStock still returns the stock level itself.
  assert.equal(one.quantityOnHand, 18)
  assert.equal(two.quantityOnHand, 16)
  assert.equal('replayed' in two, false)
  const rows = await ledgerRows(s)
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.idempotencyKey === null))
  assert.equal((await glJobs(s.tenantId)).length, 2)
})

test('adjustStock drops a key passed to it, so only postStockAdjustment can post once', async () => {
  const s = await seed()
  const dto = { skuId: s.skuId, warehouseId: s.warehouseId, quantityDelta: -1, idempotencyKey: 'k-1' } as Parameters<typeof adjustStock>[1]
  await adjustStock(s.tenantId, dto, 'u')
  await adjustStock(s.tenantId, dto, 'u')
  assert.equal((await level(s)).quantityOnHand, 18)
  assert.ok((await ledgerRows(s)).every((r) => r.idempotencyKey === null))
})

test('a replay queues the GL job lost to a crash, under the original correlation id, once', async () => {
  const s = await seed()
  const key = `cycle-count-line:${randomUUID()}`
  const first = await keyed(s, key)
  const row = await inventoryDb.stockLedgerEntry.findUniqueOrThrow({ where: { id: first.ledgerEntryId } })
  // Stock committed, then the server stopped before the job reached the order database.
  await orderDb.postingJob.deleteMany({ where: { tenantId: s.tenantId } })

  await keyed(s, key)
  const jobs = await glJobs(s.tenantId)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].kind, 'STOCK_WRITE_OFF_JOURNAL')
  assert.equal(jobs[0].sourceId, row.correlationId)
  assert.equal(jobs[0].variant, `${s.warehouseId}:${s.skuId}:`)
  assert.equal(Number((jobs[0].payload as { amount: string }).amount), 6)

  await keyed(s, key)
  assert.equal((await glJobs(s.tenantId)).length, 1)
  assert.equal((await level(s)).quantityOnHand, 17)
})

test('a replay does not post again or repeat the low-stock event', async () => {
  const s = await seed({ onHand: 12, reorderPoint: 10 })
  await tenantDb.webhookSubscription.create({
    data: { tenantId: s.tenantId, event: 'inventory.stock_level_low', url: 'http://127.0.0.1:9/hook' },
  })
  const lowEvents = () => tenantDb.webhookDelivery.count({ where: { tenantId: s.tenantId, event: 'inventory.stock_level_low' } })
  const settle = async (want: number) => {
    for (let i = 0; i < 50 && (await lowEvents()) < want; i++) await new Promise((r) => setTimeout(r, 20))
  }

  const key = `cycle-count-line:${randomUUID()}`
  await keyed(s, key, -4) // 12 -> 8, below the reorder point
  await settle(1)
  assert.equal(await lowEvents(), 1)

  // Restocked above the reorder point: a second real -4 would cross it again and fire.
  await adjustStock(s.tenantId, { skuId: s.skuId, warehouseId: s.warehouseId, quantityDelta: 6 }, 'u')
  const replay = await keyed(s, key, -4)
  assert.equal(replay.replayed, true)
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(await lowEvents(), 1)
  assert.equal((await level(s)).quantityOnHand, 14)
})

test('POST /inventory/adjust keeps its contract and ignores an idempotencyKey in the body', async () => {
  const s = await seed()
  await authDb.tenant.create({ data: { id: s.tenantId, name: 'Adj', slug: `adj-${s.tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: s.tenantId, slug: `adj-${s.tenantId.slice(-8)}`, displayName: 'Adj', settings: {}, metadata: {} },
  })
  const email = `inv-${randomUUID().slice(0, 6)}@example.test`
  const password = 'stock-adjust-pass-1'
  const user = await authDb.user.create({
    data: { tenantId: s.tenantId, email, passwordHash: await bcrypt.hash(password, 4), firstName: 'I', lastName: 'M', role: 'MANAGER', permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
  const token = (await loginUser(email, password)).accessToken

  const post = async (body: unknown) => {
    const res = await handleApiRequest(
      new Request('http://localhost/api/v1/inventory/adjust', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
  const body = { skuId: s.skuId, warehouseId: s.warehouseId, quantityDelta: -2, reason: 'count', idempotencyKey: 'client-key' }
  const one = await post(body)
  const two = await post(body)
  assert.equal(one.status, 200, JSON.stringify(one.body))
  assert.equal(two.status, 200, JSON.stringify(two.body))
  // Still the stock level, nothing added.
  const stored = await level(s)
  assert.deepEqual(Object.keys(two.body).sort(), Object.keys(stored).sort())
  assert.equal(two.body.quantityOnHand, 16)
  assert.equal(stored.quantityOnHand, 16)
  const rows = await ledgerRows(s)
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.idempotencyKey === null))

  const anon = await handleApiRequest(
    new Request('http://localhost/api/v1/inventory/adjust', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  )
  assert.equal(anon.status, 401)
})
