/**
 * Isolated fixture for the purchase requisition e2e specs: tenants of their own, created per run and removed after,
 * so the specs never depend on or change the shared seed data.
 *
 *   node --import ./server/register-paths.mjs --import tsx ../../e2e/fixtures/requisition-fixture.ts create [--second-tenant]
 *   node --import ./server/register-paths.mjs --import tsx ../../e2e/fixtures/requisition-fixture.ts snapshot <tenantId>...
 *   node --import ./server/register-paths.mjs --import tsx ../../e2e/fixtures/requisition-fixture.ts cleanup <tenantId>...
 *
 * Run from apps/web so it uses the same databases as the server under test. `create` and `snapshot` print JSON.
 * `snapshot` reads stored state directly from the databases, so a spec can prove a refused request changed nothing.
 */
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcrypt'
import { authDb, purchasingDb, tenantDb } from '../../apps/web/lib/server/db'

export type RequisitionFixture = {
  tenantId: string
  password: string
  users: { requester: string; approver: string; rep: string; admin?: string }
  supplier: { code: string; name: string }
  /** With --second-tenant: another tenant, for isolation checks. */
  other?: { tenantId: string; users: { manager: string }; supplier: { code: string; name: string } }
}

export type TenantSnapshot = {
  requisitions: Record<
    string,
    {
      status: string
      revision: number
      supplierId: string | null
      approvalRequestId: string | null
      purchaseOrderId: string | null
      updatedAt: string
      lines: Array<[number, string, number, string | null]>
    }
  >
  purchaseOrders: number
  purchaseOrdersFromRequisitions: number
  approvalRequests: Record<string, string>
  auditEvents: number
  outboxEvents: number
}

const TENANT_ID = /^e2e-req-[0-9a-f]{8}$/

async function tenantWithUsers(
  label: string,
  people: ReadonlyArray<readonly [key: string, firstName: string, lastName: string, role: 'MANAGER' | 'SALES_REP' | 'TENANT_ADMIN']>,
  passwordHash: string,
) {
  const suffix = randomBytes(4).toString('hex')
  const tenantId = `e2e-req-${suffix}`
  await authDb.tenant.create({ data: { id: tenantId, name: `E2E ${label} ${suffix}`, slug: tenantId, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: tenantId, displayName: `E2E ${label} ${suffix}`, settings: {}, metadata: {}, onboardingPhase: 'READY' },
  })
  const users: Record<string, string> = {}
  for (const [key, firstName, lastName, role] of people) {
    const email = `${key}-${suffix}@e2e.test`
    await authDb.user.create({ data: { tenantId, email, passwordHash, firstName, lastName, role, permissions: [], emailVerifiedAt: new Date() } })
    users[key] = email
  }
  const supplier = { code: `E2E${suffix.toUpperCase()}`, name: `E2E Supply ${suffix}` }
  await purchasingDb.supplier.create({ data: { tenantId, code: supplier.code, name: supplier.name } })
  return { tenantId, users, supplier }
}

async function create(secondTenant: boolean): Promise<RequisitionFixture> {
  const password = `E2e-${randomBytes(9).toString('base64url')}!`
  const passwordHash = await bcrypt.hash(password, 10)
  const a = await tenantWithUsers(
    'requisitions',
    [
      ['requester', 'Rita', 'Requester', 'MANAGER'],
      ['approver', 'Alex', 'Approver', 'MANAGER'],
      ['rep', 'Sam', 'Rep', 'SALES_REP'],
      ...(secondTenant ? ([['admin', 'Ada', 'Admin', 'TENANT_ADMIN']] as const) : []),
    ],
    passwordHash,
  )
  const fx: RequisitionFixture = {
    tenantId: a.tenantId,
    password,
    users: a.users as RequisitionFixture['users'],
    supplier: a.supplier,
  }
  if (secondTenant) {
    const b = await tenantWithUsers('other tenant', [['manager', 'Olga', 'Other', 'MANAGER']], passwordHash)
    fx.other = { tenantId: b.tenantId, users: { manager: b.users.manager }, supplier: b.supplier }
  }
  return fx
}

async function snapshot(tenantId: string): Promise<TenantSnapshot> {
  if (!TENANT_ID.test(tenantId)) throw new Error(`refusing to read ${tenantId}: not an e2e requisition tenant`)
  const reqs = await purchasingDb.purchaseRequisition.findMany({ where: { tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } }, orderBy: { number: 'asc' } })
  const approvals = await tenantDb.approvalRequest.findMany({ where: { tenantId }, select: { id: true, status: true } })
  return {
    requisitions: Object.fromEntries(
      reqs.map((r) => [
        r.number,
        {
          status: r.status,
          revision: r.revision,
          supplierId: r.supplierId,
          approvalRequestId: r.approvalRequestId,
          purchaseOrderId: r.purchaseOrderId,
          updatedAt: r.updatedAt.toISOString(),
          lines: r.lines.map((l) => [l.lineNo, l.description, l.qtyRequested, l.unitCost == null ? null : l.unitCost.toString()] as [number, string, number, string | null]),
        },
      ]),
    ),
    purchaseOrders: await purchasingDb.purchaseOrder.count({ where: { tenantId } }),
    purchaseOrdersFromRequisitions: await purchasingDb.purchaseOrder.count({ where: { tenantId, requisitionId: { not: null } } }),
    approvalRequests: Object.fromEntries(approvals.map((a) => [a.id, a.status])),
    auditEvents: await tenantDb.auditEvent.count({ where: { tenantId } }),
    outboxEvents: await purchasingDb.purchaseRequisitionEvent.count({ where: { tenantId } }),
  }
}

async function cleanup(tenantId: string) {
  if (!TENANT_ID.test(tenantId)) throw new Error(`refusing to clean up ${tenantId}: not an e2e requisition tenant`)
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
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'create') console.log(JSON.stringify(await create(args.includes('--second-tenant'))))
  else if (mode === 'snapshot' && args.length) console.log(JSON.stringify(Object.fromEntries(await Promise.all(args.map(async (t) => [t, await snapshot(t)])))))
  else if (mode === 'cleanup' && args.length) for (const t of args) await cleanup(t)
  else throw new Error('usage: requisition-fixture.ts create [--second-tenant] | snapshot <tenantId>... | cleanup <tenantId>...')
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
