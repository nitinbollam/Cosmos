import { AsyncLocalStorage } from 'node:async_hooks'
import { TENANT_EXEMPT_MODELS } from './tenant-scope-models'

/**
 * Central tenant scoping for every Prisma client.
 *
 * Tenant separation used to depend on each query remembering `tenantId`. Every client exported from
 * db.ts is now wrapped in a query extension that knows which models carry a `tenantId` column and
 * checks (and in `enforce` mode, corrects) each operation against the tenant bound to the request.
 *
 * Modes (env TENANT_SCOPE_MODE, default `audit`):
 *   off      no checks.
 *   audit    never changes a query; records every query that would have been wrong (no tenant context, a
 *            missing or mismatching tenantId filter, a create for another tenant). Safe to run in production
 *            and the way to find the remaining unscoped sites before enforcing.
 *   enforce  with a tenant bound: adds tenantId to every filter, fills it on create, and rejects a mismatching
 *            explicit tenantId. Without a tenant it only records (workers and public routes still run unbound).
 *   strict   enforce, and a tenant-owned model queried with no tenant bound throws. Fail closed.
 */

export type TenantScopeMode = 'off' | 'audit' | 'enforce' | 'strict'

type Store = { tenantId?: string; unscoped?: string }
const als = new AsyncLocalStorage<Store>()

let modeOverride: TenantScopeMode | null = null

export function tenantScopeMode(): TenantScopeMode {
  if (modeOverride) return modeOverride
  const v = (process.env.TENANT_SCOPE_MODE ?? 'audit').toLowerCase()
  return v === 'off' || v === 'enforce' || v === 'strict' ? v : 'audit'
}

/** Tests only. */
export function setTenantScopeModeForTests(mode: TenantScopeMode | null) {
  modeOverride = mode
}

/** Runs `fn` with `tenantId` bound; every query inside is checked against it. Use in workers and jobs. */
export function runWithTenant<T>(tenantId: string, fn: () => T | PromiseLike<T>): Promise<T> {
  return inStore({ tenantId }, fn)
}

/**
 * Prisma queries are lazy: they only start when awaited. Returning `ledgerDb.x.findMany()` straight out of
 * `als.run` would start the query after the scope has ended and run it unbound. Awaiting inside the scope
 * guarantees the query starts while the tenant is bound.
 */
function inStore<T>(store: Store, fn: () => T | PromiseLike<T>): Promise<T> {
  return als.run(store, async () => await fn())
}

/**
 * Deliberate cross-tenant access (login lookup, system workers, reconciliation). The reason is required
 * so each use is visible in review and in the audit report.
 */
export function runUnscoped<T>(reason: string, fn: () => T | PromiseLike<T>): Promise<T> {
  if (!reason.trim()) return Promise.reject(new Error('runUnscoped requires a reason'))
  return inStore({ unscoped: reason }, fn)
}

/** Opens a request scope. The tenant is bound later, once the session is verified. */
export function runInRequestScope<T>(fn: () => T): T {
  return als.run({}, fn)
}

/** Called by requireSession. A request is bound to one tenant for its whole life. */
export function bindRequestTenant(tenantId: string) {
  const store = als.getStore()
  if (!store) return
  if (store.tenantId && store.tenantId !== tenantId) {
    throw new Error('Request already bound to a different tenant')
  }
  store.tenantId = tenantId
}

export function currentTenantId(): string | undefined {
  return als.getStore()?.tenantId
}

// ---------------------------------------------------------------------------------------------
// Violation report
// ---------------------------------------------------------------------------------------------

export type ViolationKind = 'no-tenant-context' | 'missing-filter' | 'mismatching-tenant' | 'create-for-other-tenant'

type Violation = { kind: ViolationKind; client: string; model: string; operation: string; count: number }
const violations = new Map<string, Violation>()

function record(kind: ViolationKind, client: string, model: string, operation: string) {
  // Prisma runs extension hooks outside the caller's stack, so the report is keyed by operation, not file:line.
  const key = `${kind}|${client}.${model}.${operation}`
  const existing = violations.get(key)
  if (existing) {
    existing.count++
    return
  }
  violations.set(key, { kind, client, model, operation, count: 1 })
  if (violations.size < 2000) {
    console.warn(`[tenant-scope] ${kind}: ${client}.${model}.${operation}`)
    console.warn('[metric] tenant_scope_violations 1')
  }
}

export function tenantScopeReport() {
  const rows = [...violations.values()].sort((a, b) => b.count - a.count)
  return { mode: tenantScopeMode(), distinctSites: rows.length, total: rows.reduce((s, r) => s + r.count, 0), violations: rows }
}

export function resetTenantScopeReport() {
  violations.clear()
}

// ---------------------------------------------------------------------------------------------
// The extension
// ---------------------------------------------------------------------------------------------

const WHERE_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
])

type Args = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function filterTenant(where: unknown): string | undefined | 'complex' {
  if (!where || typeof where !== 'object') return undefined
  const t = (where as Args).tenantId
  if (t === undefined) return undefined
  if (typeof t === 'string') return t
  if (t && typeof t === 'object' && typeof t.equals === 'string') return t.equals
  return 'complex'
}

/**
 * Pure function: inspect (and, when `fix`, correct) the args of one operation.
 * Returns the args to run and any violations found.
 */
export function scopeArgs(
  operation: string,
  rawArgs: Args | undefined,
  tenantId: string,
  fix: boolean,
): { args: Args | undefined; violations: ViolationKind[] } {
  const found: ViolationKind[] = []
  const args: Args = rawArgs ? { ...rawArgs } : {}

  const checkWhere = () => {
    const t = filterTenant(args.where)
    if (t === undefined) {
      found.push('missing-filter')
      if (fix) args.where = { ...(args.where ?? {}), tenantId }
    } else if (t !== tenantId) {
      found.push('mismatching-tenant')
    }
  }
  const checkRow = (row: unknown): unknown => {
    if (!row || typeof row !== 'object') return row
    const r = row as Args
    if (r.tenantId === undefined) {
      found.push('missing-filter')
      return fix ? { ...r, tenantId } : r
    }
    if (typeof r.tenantId === 'string' && r.tenantId !== tenantId) found.push('create-for-other-tenant')
    return r
  }

  if (WHERE_OPS.has(operation)) {
    checkWhere()
    // A write may not move a row to another tenant.
    const moved = args.data && typeof args.data === 'object' ? (args.data as Args).tenantId : undefined
    if (typeof moved === 'string' && moved !== tenantId) found.push('create-for-other-tenant')
  } else if (operation === 'create') {
    args.data = checkRow(args.data)
  } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
    args.data = Array.isArray(args.data) ? args.data.map(checkRow) : checkRow(args.data)
  } else if (operation === 'upsert') {
    checkWhere()
    args.create = checkRow(args.create)
  }

  if (found.includes('mismatching-tenant') || found.includes('create-for-other-tenant')) {
    return { args: rawArgs, violations: found }
  }
  return { args: fix ? args : rawArgs, violations: found }
}

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantScopeError'
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Extendable = { $extends: any }

/**
 * Wraps one generated client. The return type is the client's own, so no call site changes.
 * `tenantModels` are the models with a `tenantId` column, taken from the generated data model.
 */
export function withTenantScope<T extends Extendable>(client: T, name: string, tenantModels: ReadonlySet<string>): T {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string
          operation: string
          args: Args
          query: (a: Args) => Promise<unknown>
        }) {
          const mode = tenantScopeMode()
          if (mode === 'off' || !tenantModels.has(model)) return query(args)
          const store = als.getStore()
          if (store?.unscoped) return query(args)

          const tenantId = store?.tenantId
          if (!tenantId) {
            record('no-tenant-context', name, model, operation)
            if (mode === 'strict') {
              throw new TenantScopeError(`${name}.${model}.${operation} called with no tenant bound`)
            }
            return query(args)
          }

          const fix = mode === 'enforce' || mode === 'strict'
          const res = scopeArgs(operation, args, tenantId, fix)
          for (const v of res.violations) record(v, name, model, operation)
          if (fix && (res.violations.includes('mismatching-tenant') || res.violations.includes('create-for-other-tenant'))) {
            throw new TenantScopeError(`${name}.${model}.${operation} targets another tenant than the request's`)
          }
          return query(res.args as Args)
        },
      },
    },
  }) as T
}

/** Models with a tenantId field, read from a generated client's data model. */
export function tenantModelsOf(dmmf: { datamodel: { models: ReadonlyArray<{ name: string; fields: ReadonlyArray<{ name: string }> }> } }) {
  const out = new Set<string>()
  for (const m of dmmf.datamodel.models) {
    if (m.fields.some((f) => f.name === 'tenantId')) out.add(m.name)
  }
  return out
}

export { TENANT_EXEMPT_MODELS }
