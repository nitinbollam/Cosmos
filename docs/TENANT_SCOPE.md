# Tenant scoping

Pleros is multi-tenant with a row-level `tenantId` column in 16 databases. Scoping used to depend on every query
remembering the filter. It is now enforced in one place: every client exported from
`apps/web/lib/server/db.ts` is wrapped by `withTenantScope` (`lib/server/tenant-scope.ts`).

## How it works

- A request binds to one tenant when its session is verified (`getSession` -> `bindRequestTenant`). Workers and
  jobs bind explicitly with `runWithTenant(tenantId, fn)`. Deliberate cross-tenant work uses
  `runUnscoped('reason', fn)`; the reason is mandatory.
- The extension knows which models carry `tenantId` (read from each generated client's data model) and checks every
  operation on them.
- Models without `tenantId` are listed with a reason in `lib/server/tenant-scope-models.ts`. A new model that is in
  neither place fails `tenant-scope.test.ts`.
- Use `await` inside the scope. Prisma queries are lazy, so `runWithTenant` awaits the callback itself; do not return an
  un-awaited query from a function that is meant to run bound.

## Modes (`TENANT_SCOPE_MODE`, default `audit`)

| Mode | Behaviour |
|---|---|
| `off` | no checks |
| `audit` | never changes a query; records every query that would be wrong. Safe in production. |
| `enforce` | with a tenant bound: adds `tenantId` to every filter, fills it on create, rejects another tenant's id. Unbound queries are recorded but run. |
| `strict` | as `enforce`, and a tenant-owned model queried with no tenant bound throws (fail closed). |

Report: `GET /api/v1/health/tenant-scope` (admin roles). It lists each distinct `client.model.operation` with its
kind (`no-tenant-context`, `missing-filter`, `mismatching-tenant`, `create-for-other-tenant`) and count. Prisma runs
extension hooks outside the caller's stack, so the report cannot name the file and line; use
`node scripts/scan-tenant-sites.mjs` for that.

## Rollout

1. Ship in `audit`. Watch the report and the `tenant_scope_violations` metric for a week of real traffic.
2. Wrap the remaining unbound entry points (workers, public/storefront routes, webhooks) in `runWithTenant` or
   `runUnscoped(reason)` until `no-tenant-context` is empty for them.
3. Flip to `enforce`, then `strict`.

Marketplace models belong to two tenants by design and are exempt (see the models file); they need their own
participant checks.

## Static triage (`node scripts/scan-tenant-sites.mjs`)

173 calls address a tenant-owned row by unique key without `tenantId` in the `where`.

- 152 are guarded: the function reads the row with the tenant (or calls a `get*(tenantId, id)` helper) first.
  Safe today, but only while that read stays above the write. Under `enforce` the filter is added regardless.
- 2 were hardened here by adding `tenantId` to the `where`: `salesChannelListing.upsert` in `sales-channels/core.ts`
  and both `notificationRequest.update` calls in `notifications.ts`.
- 21 remain flagged. Each has a disposition:

| Site | Disposition |
|---|---|
| `auth.ts` tenantInvite findUnique/update | global by design: looked up by invite token; the tenant comes from the invite |
| `session.ts` authSession.findUnique | global by design: session id from a verified JWT, checked against the user |
| `user-admin.ts` (7 sites) | safe: `loadUser` then `assertCanManage` rejects another tenant's user (404) unless the actor is the server CLI, which is global by design |
| `invoices.ts` order.update x2, invoice.update | safe: the order/invoice was loaded with `tenantId` earlier in `createCreditMemo`; covered centrally under `enforce` |
| `dispatch.ts` deliveryRoute findUnique/update | safe by call chain: `updateRouteAfterOutcome` is only called after `getRouteDetail(tenantId, ...)`; **tighten** by passing `tenantId` |
| `expense-reports.ts` expenseReport.update | safe by call chain (`recomputeTotal` follows a tenant-checked report read); **tighten** by passing `tenantId` |
| `celestial/conversations.ts` touchConversation | safe by call chain; **tighten** |
| `inventory.ts` stockReservation.update, `subscriptions.ts` subscription.update, `domain-events.ts` webhookDelivery.findUnique | system workers that sweep all tenants; wrap in `runUnscoped('...')` at step 2 of the rollout |

A test (`tenant-scope.test.ts`) fails if the unguarded count rises above 21, so the list can only shrink.

## Overhead

Order-list query (50 rows with line items, SQLite, 5 x 400 iterations, median): 2.42 ms without the extension,
2.52 ms with it, about 4%. Target was under 5%.

## Not done yet

- Nested relation writes that connect another tenant's rows are not checked.
- The cross-tenant route matrix generated from the router (needs two seeded tenants across every model).
- Lint rule banning raw client imports outside `db.ts`.
- Postgres row-level security as defence in depth.
