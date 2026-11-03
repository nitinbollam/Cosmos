import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { after, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { cycleCountLineKey } from './cycle-count-adjust'
import { authDb, inventoryDb, orderDb, tenantDb, wmsDb } from './db'
import { postStockAdjustment } from './inventory'

const PASSWORD = 'cycle-count-approve-1'
const tenants: string[] = []
const userIds: string[] = []

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await wmsDb.cycleCount.deleteMany({ where: { tenantId: { in: tenants } } })
  await orderDb.postingJob.deleteMany({ where: { tenantId: { in: tenants } } })
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId: { in: tenants } } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId: { in: tenants } } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId: { in: tenants } } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId: { in: tenants } } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: { in: tenants } } })
  await authDb.tenant.deleteMany({ where: { id: { in: tenants } } })
})

/** A tenant with a manager and one warehouse holding 10 of each SKU, every level unbatched (batchId ''). */
async function setup(codes: string[]) {
  const tenantId = `t-${randomUUID()}`
  tenants.push(tenantId)
  const slug = `cca-${tenantId.slice(-8)}`
  await authDb.tenant.create({ data: { id: tenantId, name: 'Cca', slug, settings: {} } })
  await tenantDb.tenantOrganization.create({ data: { id: tenantId, slug, displayName: 'Cca', settings: {}, metadata: {} } })
  const email = `manager-${randomUUID().slice(0, 6)}@example.test`
  const user = await authDb.user.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: 'M', lastName: 'U', role: 'MANAGER', permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
  const token = (await loginUser(email, PASSWORD)).accessToken

  const wh = await inventoryDb.warehouse.create({ data: { tenantId, name: 'Main', code: 'MAIN', address: {} } })
  const skuByCode: Record<string, string> = {}
  for (const code of codes) {
    const sku = await inventoryDb.sKU.create({
      data: { tenantId, code, name: code, category: 'x', cost: 2, price: 10, imageUrls: [], attributes: {} },
    })
    skuByCode[code] = sku.id
    await inventoryDb.stockLevel.create({
      data: { tenantId, skuId: sku.id, warehouseId: wh.id, batchId: '', quantityOnHand: 10, quantityAvailable: 10 },
    })
  }

  async function call(method: string, path: string, body?: unknown) {
    const res = await handleApiRequest(
      new Request(`http://localhost/api/v1${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  /** Creates a count, enters the counted quantities by SKU code and submits it. Returns the count and its lines by code. */
  async function submittedCount(counted: Record<string, number>) {
    const created = await call('POST', '/wms/cycle-counts', { warehouseId: wh.id, type: 'FULL' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const countId = created.body.id as string
    const lines = await wmsDb.cycleCountLine.findMany({ where: { countId } })
    const lineByCode: Record<string, string> = {}
    for (const [code, qty] of Object.entries(counted)) {
      const line = lines.find((l) => l.skuId === skuByCode[code])!
      lineByCode[code] = line.id
      assert.equal((await call('PATCH', `/wms/cycle-counts/${countId}/lines/${line.id}`, { countedQty: qty })).status, 200)
    }
    assert.equal((await call('PATCH', `/wms/cycle-counts/${countId}/submit-for-approval`)).status, 200)
    return { countId, lineByCode }
  }

  const onHand = async (code: string) =>
    (await inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId: skuByCode[code], warehouseId: wh.id, batchId: '' } })).quantityOnHand
  const ledgerFor = (countId: string, code?: string) =>
    inventoryDb.stockLedgerEntry.findMany({
      where: { tenantId, referenceType: 'CYCLE_COUNT', referenceId: countId, ...(code ? { skuId: skuByCode[code] } : {}) },
    })
  const glJobs = () => orderDb.postingJob.findMany({ where: { tenantId, sourceType: 'StockAdjustment' } })
  const line = (id: string) => wmsDb.cycleCountLine.findUniqueOrThrow({ where: { id } })
  const status = async (countId: string) => (await wmsDb.cycleCount.findUniqueOrThrow({ where: { id: countId } })).status
  const claim = (countId: string) =>
    wmsDb.cycleCount.findUniqueOrThrow({ where: { id: countId }, select: { approvalClaimId: true, approvalClaimExpiresAt: true } })

  return { tenantId, warehouseId: wh.id, skuByCode, call, submittedCount, onHand, ledgerFor, glJobs, line, status, claim }
}

/** The approve URL the admin Counts tab calls, with the count id replaced. */
function clientApprovePath(countId: string) {
  const src = readFileSync(new URL('../../../client/src/pages/admin/warehouse/tabs/counts-tab.tsx', import.meta.url), 'utf8')
  const m = src.match(/mutationFn: \(id: string\) => api\.patch\(`\/wms\/cycle-counts\/\$\{id\}\/(approve)`\)/)
  assert.ok(m, 'counts-tab.tsx approve call not found')
  return `/wms/cycle-counts/${countId}/${m[1]}`
}

test('approving posts each variance line once, records its ledger row, and skips lines with no variance', async () => {
  const s = await setup(['GAIN', 'LOSS', 'EVEN'])
  const { countId, lineByCode } = await s.submittedCount({ GAIN: 13, LOSS: 6, EVEN: 10 })

  const res = await s.call('PATCH', clientApprovePath(countId))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  // Existing fields unchanged; alreadyPosted is additive.
  assert.equal(res.body.adjustmentsPosted, 2)
  assert.equal(res.body.skipped, 1)
  assert.equal(res.body.alreadyPosted, 0)
  assert.deepEqual(res.body.errors, [])
  assert.equal((res.body.count as { status: string }).status, 'COMPLETED')
  assert.equal(await s.status(countId), 'COMPLETED')

  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal(await s.onHand('LOSS'), 6)
  assert.equal(await s.onHand('EVEN'), 10)

  const [gain] = await s.ledgerFor(countId, 'GAIN')
  const [loss] = await s.ledgerFor(countId, 'LOSS')
  assert.equal((await s.ledgerFor(countId)).length, 2)
  assert.equal(gain.quantityDelta, 3)
  assert.equal(loss.quantityDelta, -4)
  assert.equal(gain.idempotencyKey, cycleCountLineKey(lineByCode.GAIN))
  assert.equal(loss.idempotencyKey, cycleCountLineKey(lineByCode.LOSS))

  assert.equal((await s.line(lineByCode.GAIN)).postedLedgerId, gain.id)
  assert.equal((await s.line(lineByCode.LOSS)).postedLedgerId, loss.id)
  assert.equal((await s.line(lineByCode.EVEN)).postedLedgerId, null)

  const jobs = await s.glJobs()
  assert.equal(jobs.length, 2)
  assert.deepEqual(jobs.map((j) => j.kind).sort(), ['STOCK_FOUND_JOURNAL', 'STOCK_WRITE_OFF_JOURNAL'])
  assert.deepEqual(new Set(jobs.map((j) => j.sourceId)), new Set([gain.correlationId, loss.correlationId]))
})

test('approving a completed count again changes nothing', async () => {
  const s = await setup(['GAIN', 'LOSS'])
  const { countId } = await s.submittedCount({ GAIN: 12, LOSS: 9 })
  assert.equal((await s.call('PATCH', clientApprovePath(countId))).status, 200)

  const again = await s.call('POST', `/wms/cycle-counts/${countId}/approve`)
  assert.equal(again.status, 200, JSON.stringify(again.body))
  assert.equal(again.body.adjustmentsPosted, 0)
  assert.equal(again.body.skipped, 2)
  assert.equal(await s.onHand('GAIN'), 12)
  assert.equal(await s.onHand('LOSS'), 9)
  assert.equal((await s.ledgerFor(countId)).length, 2)
  assert.equal((await s.glJobs()).length, 2)
})

test('a partial failure keeps what posted; the retry posts only the rest and then completes', async () => {
  const s = await setup(['GAIN', 'LOSS', 'HELD'])
  // HELD has 8 of its 10 reserved, so taking 5 off fails.
  await inventoryDb.stockLevel.updateMany({
    where: { tenantId: s.tenantId, skuId: s.skuByCode.HELD },
    data: { quantityReserved: 8, quantityAvailable: 2 },
  })
  const { countId, lineByCode } = await s.submittedCount({ GAIN: 13, LOSS: 6, HELD: 5 })

  const failed = await s.call('PATCH', clientApprovePath(countId))
  assert.equal(failed.status, 400)
  assert.match(String(failed.body.error ?? failed.body.message ?? JSON.stringify(failed.body)), /Could not post all adjustments/)
  assert.equal(await s.status(countId), 'PENDING_APPROVAL')
  // The failed approval gave its claim back, so the retry below can start at once.
  assert.equal((await s.claim(countId)).approvalClaimId, null)
  const gainId = (await s.line(lineByCode.GAIN)).postedLedgerId
  const lossId = (await s.line(lineByCode.LOSS)).postedLedgerId
  assert.ok(gainId && lossId)
  assert.equal((await s.line(lineByCode.HELD)).postedLedgerId, null)
  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal(await s.onHand('LOSS'), 6)
  assert.equal(await s.onHand('HELD'), 10)
  assert.equal((await s.ledgerFor(countId)).length, 2)
  assert.equal((await s.glJobs()).length, 2)

  // The reservation is released; approving again finishes the count.
  await inventoryDb.stockLevel.updateMany({
    where: { tenantId: s.tenantId, skuId: s.skuByCode.HELD },
    data: { quantityReserved: 0, quantityAvailable: 10 },
  })
  const retry = await s.call('PATCH', clientApprovePath(countId))
  assert.equal(retry.status, 200, JSON.stringify(retry.body))
  assert.equal(retry.body.adjustmentsPosted, 1)
  assert.equal(retry.body.alreadyPosted, 2)
  assert.equal(retry.body.skipped, 0)
  assert.equal(await s.status(countId), 'COMPLETED')

  // Lines posted the first time were not adjusted again, and kept their ledger rows.
  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal(await s.onHand('LOSS'), 6)
  assert.equal(await s.onHand('HELD'), 5)
  assert.equal((await s.line(lineByCode.GAIN)).postedLedgerId, gainId)
  assert.equal((await s.line(lineByCode.LOSS)).postedLedgerId, lossId)
  const [held] = await s.ledgerFor(countId, 'HELD')
  assert.equal((await s.line(lineByCode.HELD)).postedLedgerId, held.id)
  for (const code of ['GAIN', 'LOSS', 'HELD']) assert.equal((await s.ledgerFor(countId, code)).length, 1, code)
  assert.equal((await s.glJobs()).length, 3)
})

test('a crash after the inventory commit and before the WMS marker does not post the line twice', async () => {
  const s = await setup(['GAIN', 'LOSS'])
  const { countId, lineByCode } = await s.submittedCount({ GAIN: 13, LOSS: 6 })

  // What approval had done for GAIN when the server stopped: stock and ledger committed, marker not saved,
  // and the GL job never reached the order database.
  const committed = await postStockAdjustment(
    s.tenantId,
    {
      skuId: s.skuByCode.GAIN,
      warehouseId: s.warehouseId,
      quantityDelta: 3,
      batchId: '',
      referenceId: countId,
      referenceType: 'CYCLE_COUNT',
      ledger: true,
      idempotencyKey: cycleCountLineKey(lineByCode.GAIN),
    },
    'u',
  )
  await orderDb.postingJob.deleteMany({ where: { tenantId: s.tenantId } })
  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal((await s.line(lineByCode.GAIN)).postedLedgerId, null)
  assert.equal(await s.status(countId), 'PENDING_APPROVAL')

  const res = await s.call('PATCH', clientApprovePath(countId))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.adjustmentsPosted, 1)
  assert.equal(res.body.alreadyPosted, 1)
  assert.equal(await s.status(countId), 'COMPLETED')

  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal(await s.onHand('LOSS'), 6)
  assert.equal((await s.ledgerFor(countId, 'GAIN')).length, 1)
  assert.equal((await s.ledgerFor(countId, 'LOSS')).length, 1)
  assert.equal((await s.line(lineByCode.GAIN)).postedLedgerId, committed.ledgerEntryId)

  // GAIN's lost GL job was queued again under its original correlation id; one job per adjustment.
  const committedRow = await inventoryDb.stockLedgerEntry.findUniqueOrThrow({ where: { id: committed.ledgerEntryId } })
  const jobs = await s.glJobs()
  assert.equal(jobs.length, 2)
  assert.equal(jobs.filter((j) => j.sourceId === committedRow.correlationId).length, 1)
})

test('a line already marked as posted is not sent to inventory again', async () => {
  const s = await setup(['GAIN', 'LOSS'])
  const { countId, lineByCode } = await s.submittedCount({ GAIN: 13, LOSS: 6 })
  // An earlier attempt posted GAIN and recorded it, then stopped before completing the count.
  const earlier = await postStockAdjustment(
    s.tenantId,
    { skuId: s.skuByCode.GAIN, warehouseId: s.warehouseId, quantityDelta: 3, batchId: '', referenceId: countId, referenceType: 'CYCLE_COUNT', ledger: true, idempotencyKey: cycleCountLineKey(lineByCode.GAIN) },
    'u',
  )
  await wmsDb.cycleCountLine.update({ where: { id: lineByCode.GAIN }, data: { postedLedgerId: earlier.ledgerEntryId } })

  const res = await s.call('PATCH', clientApprovePath(countId))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.adjustmentsPosted, 1)
  assert.equal(res.body.alreadyPosted, 1)
  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal(await s.onHand('LOSS'), 6)
  assert.equal((await s.ledgerFor(countId)).length, 2)
  assert.equal((await s.line(lineByCode.GAIN)).postedLedgerId, earlier.ledgerEntryId)
  assert.equal((await s.glJobs()).length, 2)
})

// ---- One approval at a time (ticket 49, phase 3) ----

type Run = (fn: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) => Promise<unknown>

/**
 * Runs `body` with a database client's `$transaction` wrapped, so a test can act between steps of an approval:
 * the inventory client's transaction is one line's stock posting, the WMS client's is recording that posting.
 */
async function withTransactionHook<T>(
  client: object,
  hook: { before?: (call: number) => Promise<void>; after?: (call: number) => Promise<void> },
  body: () => Promise<T>,
): Promise<T> {
  const c = client as { $transaction: Run }
  const real = c.$transaction
  let calls = 0
  c.$transaction = async (fn, ...rest) => {
    const n = ++calls
    await hook.before?.(n)
    const result = await real.call(client, fn, ...rest)
    await hook.after?.(n)
    return result
  }
  try {
    return await body()
  } finally {
    c.$transaction = real
  }
}

const takeOver = (countId: string, token = 'worker-b') =>
  wmsDb.cycleCount.update({ where: { id: countId }, data: { approvalClaimId: token, approvalClaimExpiresAt: new Date(Date.now() + 60_000) } })
const expireClaim = (countId: string) =>
  wmsDb.cycleCount.update({ where: { id: countId }, data: { approvalClaimExpiresAt: new Date(Date.now() - 1_000) } })

test('simultaneous approvals post each line once: one request does the work', async () => {
  const s = await setup(['GAIN', 'LOSS'])
  const { countId } = await s.submittedCount({ GAIN: 13, LOSS: 6 })

  const results = await Promise.all(Array.from({ length: 5 }, () => s.call('PATCH', clientApprovePath(countId))))
  for (const r of results) assert.ok(r.status === 200 || r.status === 409, `${r.status} ${JSON.stringify(r.body)}`)
  const ok = results.filter((r) => r.status === 200)
  assert.ok(ok.length >= 1)
  // Only the request holding the claim posted; the others were refused or saw the finished count.
  assert.equal(ok.reduce((n, r) => n + Number(r.body.adjustmentsPosted), 0), 2)
  for (const r of results.filter((x) => x.status === 409)) {
    assert.equal(r.body.message, 'This count is already being approved; try again shortly.')
  }

  assert.equal(await s.status(countId), 'COMPLETED')
  assert.deepEqual(await s.claim(countId), { approvalClaimId: null, approvalClaimExpiresAt: null })
  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal(await s.onHand('LOSS'), 6)
  assert.equal((await s.ledgerFor(countId, 'GAIN')).length, 1)
  assert.equal((await s.ledgerFor(countId, 'LOSS')).length, 1)
  assert.equal((await s.glJobs()).length, 2)
})

test('a crashed approval leaves a claim that refuses others until it expires, then a retry finishes safely', async () => {
  const s = await setup(['GAIN', 'LOSS'])
  const { countId, lineByCode } = await s.submittedCount({ GAIN: 13, LOSS: 6 })
  // The crashed request had claimed the count and posted GAIN's stock, but recorded nothing in WMS.
  const posted = await postStockAdjustment(
    s.tenantId,
    { skuId: s.skuByCode.GAIN, warehouseId: s.warehouseId, quantityDelta: 3, batchId: '', referenceId: countId, referenceType: 'CYCLE_COUNT', ledger: true, idempotencyKey: cycleCountLineKey(lineByCode.GAIN) },
    'u',
  )
  await takeOver(countId, 'crashed-worker')

  const refused = await s.call('PATCH', clientApprovePath(countId))
  assert.equal(refused.status, 409)
  assert.equal(refused.body.message, 'This count is already being approved; try again shortly.')
  assert.equal((await s.claim(countId)).approvalClaimId, 'crashed-worker')
  assert.equal(await s.onHand('LOSS'), 10)
  assert.equal((await s.ledgerFor(countId)).length, 1)

  await expireClaim(countId)
  const res = await s.call('PATCH', clientApprovePath(countId))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.adjustmentsPosted, 1)
  assert.equal(res.body.alreadyPosted, 1)
  assert.equal(await s.status(countId), 'COMPLETED')
  assert.deepEqual(await s.claim(countId), { approvalClaimId: null, approvalClaimExpiresAt: null })
  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal(await s.onHand('LOSS'), 6)
  assert.equal((await s.ledgerFor(countId)).length, 2)
  assert.equal((await s.line(lineByCode.GAIN)).postedLedgerId, posted.ledgerEntryId)
  assert.equal((await s.glJobs()).length, 2)
})

test('an approval that loses its claim stops posting and leaves the new holder alone', async () => {
  const s = await setup(['GAIN', 'LOSS', 'MORE'])
  const { countId, lineByCode } = await s.submittedCount({ GAIN: 13, LOSS: 6, MORE: 12 })

  // While the first line's stock is being posted, another request takes the count over.
  let postings = 0
  const res = await withTransactionHook(
    inventoryDb,
    {
      before: async (n) => {
        postings = n
        if (n === 1) await takeOver(countId)
      },
    },
    () => s.call('PATCH', clientApprovePath(countId)),
  )
  assert.equal(res.status, 409)
  assert.equal(res.body.message, 'This count is now being approved by another request; try again shortly.')
  assert.equal(postings, 1, 'no further line was posted after the claim was lost')
  // The other request's claim is untouched, nothing was recorded, and the count is not completed.
  assert.equal((await s.claim(countId)).approvalClaimId, 'worker-b')
  assert.equal(await s.status(countId), 'PENDING_APPROVAL')
  const rows = await s.ledgerFor(countId)
  assert.equal(rows.length, 1)
  for (const code of ['GAIN', 'LOSS', 'MORE']) assert.equal((await s.line(lineByCode[code])).postedLedgerId, null)

  // The holder (here: a retry once that claim lapses) finds the stray posting by its key and finishes.
  await expireClaim(countId)
  const done = await s.call('PATCH', clientApprovePath(countId))
  assert.equal(done.status, 200, JSON.stringify(done.body))
  assert.equal(done.body.adjustmentsPosted, 2)
  assert.equal(done.body.alreadyPosted, 1)
  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal(await s.onHand('LOSS'), 6)
  assert.equal(await s.onHand('MORE'), 12)
  for (const code of ['GAIN', 'LOSS', 'MORE']) assert.equal((await s.ledgerFor(countId, code)).length, 1, code)
  const stray = rows[0]
  const strayCode = Object.keys(s.skuByCode).find((c) => s.skuByCode[c] === stray.skuId)!
  assert.equal((await s.line(lineByCode[strayCode])).postedLedgerId, stray.id)
  assert.equal((await s.glJobs()).length, 3)
})

test('an approval that lost its claim after the last line cannot complete the count', async () => {
  const s = await setup(['GAIN', 'EVEN'])
  const { countId, lineByCode } = await s.submittedCount({ GAIN: 13, EVEN: 10 })

  // GAIN's posting is recorded under the claim; right after, another request takes the count over.
  const res = await withTransactionHook(wmsDb, { after: async () => void (await takeOver(countId)) }, () =>
    s.call('PATCH', clientApprovePath(countId)),
  )
  assert.equal(res.status, 409)
  assert.equal(res.body.message, 'This count is now being approved by another request; try again shortly.')
  assert.equal(await s.status(countId), 'PENDING_APPROVAL')
  assert.equal((await s.claim(countId)).approvalClaimId, 'worker-b')
  const [gain] = await s.ledgerFor(countId, 'GAIN')
  assert.equal((await s.line(lineByCode.GAIN)).postedLedgerId, gain.id)

  await expireClaim(countId)
  const done = await s.call('PATCH', clientApprovePath(countId))
  assert.equal(done.status, 200, JSON.stringify(done.body))
  assert.equal(done.body.adjustmentsPosted, 0)
  assert.equal(done.body.alreadyPosted, 1)
  assert.equal(await s.status(countId), 'COMPLETED')
  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal((await s.ledgerFor(countId)).length, 1)
  assert.equal((await s.glJobs()).length, 1)
})

test('a posting recorded by another request is never replaced', async () => {
  const s = await setup(['GAIN', 'EVEN'])
  const { countId, lineByCode } = await s.submittedCount({ GAIN: 13, EVEN: 10 })

  // While GAIN is being posted, its line gets a posting recorded by someone else.
  const res = await withTransactionHook(
    inventoryDb,
    { before: async () => void (await wmsDb.cycleCountLine.update({ where: { id: lineByCode.GAIN }, data: { postedLedgerId: 'recorded-elsewhere' } })) },
    () => s.call('PATCH', clientApprovePath(countId)),
  )
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal((await s.line(lineByCode.GAIN)).postedLedgerId, 'recorded-elsewhere')
  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal((await s.ledgerFor(countId)).length, 1)
})

test('a long approval renews its claim before every line it posts', async () => {
  const s = await setup(['GAIN', 'LOSS', 'MORE'])
  const { countId } = await s.submittedCount({ GAIN: 13, LOSS: 6, MORE: 12 })

  const leftAtPosting: number[] = []
  const res = await withTransactionHook(
    inventoryDb,
    {
      before: async () => {
        leftAtPosting.push((await s.claim(countId)).approvalClaimExpiresAt!.getTime() - Date.now())
        // Each line takes longer than the claim lasts.
        await expireClaim(countId)
      },
    },
    () => s.call('PATCH', clientApprovePath(countId)),
  )
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(leftAtPosting.length, 3)
  for (const ms of leftAtPosting) assert.ok(ms > 50_000, `claim had only ${ms}ms left when a line was posted`)
  assert.equal(await s.status(countId), 'COMPLETED')
  assert.deepEqual(await s.claim(countId), { approvalClaimId: null, approvalClaimExpiresAt: null })
  assert.equal((await s.ledgerFor(countId)).length, 3)
})

test('another tenant cannot approve or claim the count', async () => {
  const a = await setup(['GAIN'])
  const b = await setup(['GAIN'])
  const { countId } = await a.submittedCount({ GAIN: 13 })

  const res = await b.call('PATCH', clientApprovePath(countId))
  assert.equal(res.status, 404)
  assert.equal(await a.status(countId), 'PENDING_APPROVAL')
  assert.deepEqual(await a.claim(countId), { approvalClaimId: null, approvalClaimExpiresAt: null })
  assert.equal(await a.onHand('GAIN'), 10)
  assert.equal((await a.ledgerFor(countId)).length, 0)

  assert.equal((await a.call('POST', `/wms/cycle-counts/${countId}/approve`)).status, 200)
  assert.equal(await a.onHand('GAIN'), 13)
})

// ---- Postings made before ticket 49 (phase 4) ----

const REVIEW_REQUIRED = 'This cycle count contains historical inventory postings that require review before approval.'

/** A stock posting an approval made before postings had idempotency keys (the stock change itself is not replayed here). */
function legacyPosting(
  s: Awaited<ReturnType<typeof setup>>,
  countId: string,
  code: string,
  quantityDelta: number,
  opts: { tenantId?: string; correlationId?: string } = {},
) {
  return inventoryDb.stockLedgerEntry.create({
    data: {
      id: randomUUID(),
      tenantId: opts.tenantId ?? s.tenantId,
      skuId: s.skuByCode[code],
      warehouseId: s.warehouseId,
      batchId: '',
      eventType: 'STOCK_ADJUSTED',
      quantityDelta,
      quantityAfter: 10 + quantityDelta,
      unitCost: '2',
      referenceId: countId,
      referenceType: 'CYCLE_COUNT',
      performedBy: 'old-approval',
      correlationId: opts.correlationId ?? randomUUID(),
    },
  })
}

/** Approval refused for review: nothing posted, recorded, queued or left claimed. */
async function assertBlockedUntouched(s: Awaited<ReturnType<typeof setup>>, countId: string, codes: string[], legacyRows: number) {
  const res = await s.call('PATCH', clientApprovePath(countId))
  assert.equal(res.status, 409, JSON.stringify(res.body))
  assert.equal(res.body.message, REVIEW_REQUIRED)
  for (const code of codes) assert.equal(await s.onHand(code), 10, code)
  const rows = await s.ledgerFor(countId)
  assert.equal(rows.length, legacyRows)
  assert.ok(rows.every((r) => r.idempotencyKey === null), 'no new keyed posting')
  assert.equal((await s.glJobs()).length, 0)
  assert.equal(await s.status(countId), 'PENDING_APPROVAL')
  assert.deepEqual(await s.claim(countId), { approvalClaimId: null, approvalClaimExpiresAt: null })
  const lines = await wmsDb.cycleCountLine.findMany({ where: { countId } })
  assert.ok(lines.every((l) => l.postedLedgerId === null), 'no line was marked as posted')
  return res
}

test('a count with one historical posting is refused for review before anything is posted', async () => {
  const s = await setup(['GAIN', 'LOSS'])
  const { countId } = await s.submittedCount({ GAIN: 13, LOSS: 6 })
  await legacyPosting(s, countId, 'GAIN', 3)

  await assertBlockedUntouched(s, countId, ['GAIN', 'LOSS'], 1)
  // The claim was given back: asking again gets the same answer, not "already being approved".
  await assertBlockedUntouched(s, countId, ['GAIN', 'LOSS'], 1)
})

test('a count with several historical postings is refused', async () => {
  const s = await setup(['GAIN', 'LOSS'])
  const { countId } = await s.submittedCount({ GAIN: 13, LOSS: 6 })
  const attempt1 = randomUUID()
  await legacyPosting(s, countId, 'GAIN', 3, { correlationId: attempt1 })
  await legacyPosting(s, countId, 'LOSS', -4, { correlationId: attempt1 })
  await legacyPosting(s, countId, 'GAIN', 3) // a retry posted GAIN again

  await assertBlockedUntouched(s, countId, ['GAIN', 'LOSS'], 3)
})

test('a count with two lines for one SKU and a historical posting is refused', async () => {
  const s = await setup(['GAIN', 'LOSS'])
  const created = await s.call('POST', '/wms/cycle-counts', { warehouseId: s.warehouseId, type: 'FULL' })
  const countId = created.body.id as string
  // A second line for GAIN (a SKU can have both a NULL-batch and a ''-batch stock level).
  await wmsDb.cycleCountLine.create({ data: { countId, skuId: s.skuByCode.GAIN, systemQty: 10, countedQty: 13 } })
  for (const l of await wmsDb.cycleCountLine.findMany({ where: { countId, countedQty: null } })) {
    await wmsDb.cycleCountLine.update({ where: { id: l.id }, data: { countedQty: l.skuId === s.skuByCode.GAIN ? 13 : 6 } })
  }
  assert.equal((await s.call('PATCH', `/wms/cycle-counts/${countId}/submit-for-approval`)).status, 200)
  await legacyPosting(s, countId, 'GAIN', 3)

  await assertBlockedUntouched(s, countId, ['GAIN', 'LOSS'], 1)
})

test('a historical posting for another quantity is refused, not reposted', async () => {
  const s = await setup(['GAIN'])
  const { countId } = await s.submittedCount({ GAIN: 13 })
  await legacyPosting(s, countId, 'GAIN', 5) // the line's variance is +3

  await assertBlockedUntouched(s, countId, ['GAIN'], 1)
})

test("another tenant's or another count's historical postings do not block this count", async () => {
  const s = await setup(['GAIN', 'LOSS'])
  const { countId } = await s.submittedCount({ GAIN: 13, LOSS: 6 })
  const { countId: otherCount } = await s.submittedCount({ GAIN: 11, LOSS: 10 })
  const foreignTenant = `t-${randomUUID()}`
  tenants.push(foreignTenant)
  await legacyPosting(s, countId, 'GAIN', 3, { tenantId: foreignTenant })
  await legacyPosting(s, otherCount, 'GAIN', 1)

  const res = await s.call('PATCH', clientApprovePath(countId))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.adjustmentsPosted, 2)
  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal(await s.onHand('LOSS'), 6)
  assert.equal((await s.ledgerFor(countId)).length, 2)
  assert.ok((await s.ledgerFor(countId)).every((r) => r.idempotencyKey !== null))
  assert.equal((await s.glJobs()).length, 2)
  // The other count is still refused.
  assert.equal((await s.call('PATCH', clientApprovePath(otherCount))).status, 409)
})

test('once a person records a historical posting on its line, approval posts only the other lines', async () => {
  const s = await setup(['GAIN', 'LOSS'])
  const { countId, lineByCode } = await s.submittedCount({ GAIN: 13, LOSS: 6 })
  const old = await legacyPosting(s, countId, 'GAIN', 3)
  await inventoryDb.stockLevel.updateMany({ where: { tenantId: s.tenantId, skuId: s.skuByCode.GAIN }, data: { quantityOnHand: { increment: 3 }, quantityAvailable: { increment: 3 } } })
  await assertBlockedUntouched(s, countId, ['LOSS'], 1)

  // The manual review accepts the old posting as GAIN's adjustment.
  await wmsDb.cycleCountLine.update({ where: { id: lineByCode.GAIN }, data: { postedLedgerId: old.id } })
  const res = await s.call('PATCH', clientApprovePath(countId))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.adjustmentsPosted, 1)
  assert.equal(res.body.alreadyPosted, 1)
  assert.equal(await s.status(countId), 'COMPLETED')
  assert.equal(await s.onHand('GAIN'), 13)
  assert.equal(await s.onHand('LOSS'), 6)
  assert.equal((await s.ledgerFor(countId, 'GAIN')).length, 1)
  assert.equal((await s.ledgerFor(countId, 'LOSS')).length, 1)
  assert.equal((await s.line(lineByCode.GAIN)).postedLedgerId, old.id)
  assert.equal((await s.glJobs()).length, 1)
})
