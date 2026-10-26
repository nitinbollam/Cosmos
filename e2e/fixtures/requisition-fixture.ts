/**
 * Isolated fixture for e2e/purchase-requisitions.spec.ts: a tenant of its own, created per run and removed after,
 * so the spec never depends on or changes the shared seed data.
 *
 *   node --import ./server/register-paths.mjs --import tsx ../../e2e/fixtures/requisition-fixture.ts create
 *   node --import ./server/register-paths.mjs --import tsx ../../e2e/fixtures/requisition-fixture.ts cleanup <tenantId>
 *
 * Run from apps/web so it uses the same databases as the server under test. `create` prints the fixture as JSON.
 */
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcrypt'
import { authDb, purchasingDb, tenantDb } from '../../apps/web/lib/server/db'

export type RequisitionFixture = {
  tenantId: string
  password: string
  users: { requester: string; approver: string; rep: string }
  supplier: { code: string; name: string }
}

async function create(): Promise<RequisitionFixture> {
  const suffix = randomBytes(4).toString('hex')
  const tenantId = `e2e-req-${suffix}`
  const password = `E2e-${randomBytes(9).toString('base64url')}!`
  const users = {
    requester: `requester-${suffix}@e2e.test`,
    approver: `approver-${suffix}@e2e.test`,
    rep: `rep-${suffix}@e2e.test`,
  }
  const supplier = { code: `E2E${suffix.toUpperCase()}`, name: `E2E Supply ${suffix}` }
  await authDb.tenant.create({ data: { id: tenantId, name: `E2E requisitions ${suffix}`, slug: tenantId, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: tenantId, displayName: `E2E requisitions ${suffix}`, settings: {}, metadata: {}, onboardingPhase: 'READY' },
  })
  const passwordHash = await bcrypt.hash(password, 10)
  const people = [
    [users.requester, 'Rita', 'Requester', 'MANAGER'],
    [users.approver, 'Alex', 'Approver', 'MANAGER'],
    [users.rep, 'Sam', 'Rep', 'SALES_REP'],
  ] as const
  for (const [email, firstName, lastName, role] of people) {
    await authDb.user.create({ data: { tenantId, email, passwordHash, firstName, lastName, role, permissions: [], emailVerifiedAt: new Date() } })
  }
  await purchasingDb.supplier.create({ data: { tenantId, code: supplier.code, name: supplier.name } })
  return { tenantId, password, users, supplier }
}

async function cleanup(tenantId: string) {
  if (!/^e2e-req-[0-9a-f]{8}$/.test(tenantId)) throw new Error(`refusing to clean up ${tenantId}: not an e2e requisition tenant`)
  const userIds = (await authDb.user.findMany({ where: { tenantId }, select: { id: true } })).map((u) => u.id)
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { tenantId } })
  await purchasingDb.purchaseOrder.deleteMany({ where: { tenantId } })
  await purchasingDb.purchaseRequisition.deleteMany({ where: { tenantId } })
  await purchasingDb.purchaseRequisitionEvent.deleteMany({ where: { tenantId } })
  await purchasingDb.purchaseRequisitionCounter.deleteMany({ where: { tenantId } })
  await purchasingDb.supplier.deleteMany({ where: { tenantId } })
  await tenantDb.approvalRequest.deleteMany({ where: { tenantId } })
  await tenantDb.auditEvent.deleteMany({ where: { tenantId } })
  await tenantDb.webhookDelivery.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: tenantId } })
  await authDb.tenant.deleteMany({ where: { id: tenantId } })
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('e2e fixtures never run against production')
  const [mode, arg] = process.argv.slice(2)
  if (mode === 'create') console.log(JSON.stringify(await create()))
  else if (mode === 'cleanup' && arg) await cleanup(arg)
  else throw new Error('usage: requisition-fixture.ts create | cleanup <tenantId>')
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
