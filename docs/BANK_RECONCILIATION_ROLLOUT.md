# Bank reconciliation: rollout, rollback and test guide

Covers the ledger schema change that adds bank reconciliation (statement imports, matching, sign-off, period locks).
Read it before deploying this feature to any environment, and before rolling it back.

Everything below was verified on **disposable** local PostgreSQL clusters (16.15 and 18.6) with synthetic data.
None of it has been run against staging or production. Staging comes first, and each environment needs its own approval.

## 1. What a deploy runs

The image (`apps/web/Dockerfile`) runs `node scripts/start-server.mjs` with `NODE_ENV=production`. It is used by Render
(`render.yaml`, `PLEROS_DB_PROVIDER=postgres`) and by EKS (`.github/workflows/deploy-staging.yml` and
`deploy-production.yml`, `infra/k8s`, a rolling update of 2 replicas).

`scripts/start-server.mjs`, in order:

| Step | What it does | Skipped by `PLEROS_SKIP_DB_MIGRATE=1`? |
|---|---|---|
| 1 | Derives each missing `*_DATABASE_URL` from `DATABASE_URL` | no |
| 2 | `npm run db:migrate` (`scripts/migrate-all.ts`): rewrites every schema's provider (`apply-prisma-provider.mjs`), then for each of the 16 schemas runs `prisma db push --accept-data-loss`, **which also regenerates that Prisma client**. In production a failure exits the process. | **yes** |
| 3 | Order-number backfill (a failure is logged, not fatal) | **yes** |
| 4 | Optional super-admin bootstrap (`PLEROS_BOOTSTRAP_ADMIN_*`) | no |
| 5 | Starts the server | no |

### The Prisma-client generation requirement
The committed schemas say `provider = "sqlite"`, and the Docker build runs `npm run db:generate -w @pleros/web` on them.
**The image therefore ships SQLite clients.** On Postgres, only step 2 switches the provider and regenerates them.

So `PLEROS_SKIP_DB_MIGRATE=1` **on its own boots a Postgres deployment with SQLite clients.** Verified on PostgreSQL 16:
the server starts, but every query fails with `PrismaClientInitializationError: the URL must start with the protocol
"file:"`. Whenever migrations are skipped, generate Postgres clients first:

```sh
node scripts/apply-prisma-provider.mjs && npm run db:generate -w @pleros/web
```

`apply-prisma-provider.mjs` reads `PLEROS_DB_PROVIDER`, and `db:generate` only writes files under `apps/web/generated`.
Neither touches a database. The runtime user owns `apps/web`, so this works in the container.

## 2. Before deploying (per environment)

1. Take a snapshot of the **ledger** database and record its id.
2. Run the read-only preflight against that environment's ledger database:
   ```sh
   BANK_RECON_PREFLIGHT_ENV=staging LEDGER_DATABASE_URL=<ledger url> npx tsx scripts/bank-reconciliation-schema-preflight.ts
   ```
   Production also needs `--production-approval <TICKET-n> --expect-db-fingerprint <hex>`, which the script enforces.
   The script runs SELECTs in a read-only transaction, prints counts and record ids only, and repairs nothing.
3. **BLOCKER on check 1** (two bank accounts of one tenant linked to the same GL account): resolve every duplicate
   before deploying. Which account keeps the GL link is a finance decision. Otherwise the deploy fails (section 3).
4. Record the INFO counts:
   - check 3: statement lines without a dedupe key;
   - check 4: lines reconciled by the retired workflow.

   For every account listed in check 3, decide on section 5 **before its first CSV import**.
5. Tell finance users and API consumers about the behavior changes in section 6.

## 3. What the deploy does to the database

**Clean upgrade:**
- Existing rows, sums, `currentBalance`, `reconciled` flags and the Plaid sync cursor are unchanged.
- The new columns get defaults: `currency = USD`, `source = API`, `createdAt = now()`.
- `dedupeKey` and `lockedAt` are NULL on existing lines.
- 5 tables and 7 columns are added, plus 2 unique indexes.
- A second push changes nothing.

**Duplicate GL link:**
- The push fails with `P2002` on `(tenantId, chartAccountId)`. In production the process exits and the server does not start.
- Expected but not tested on either platform: on Render the deploy fails its health check and the previous instance
  keeps serving; on EKS the new pods crash-loop and the rolling update stalls.

**The failed push leaves a partial schema.** The push is not atomic: the new tables and columns **are** created and only
the two unique indexes are missing. Running the old code on that schema is safe, because it doesn't use the new objects.

To recover:
1. Resolve the duplicate link (a finance decision, applied as a reviewed change).
2. Run the preflight again until there are no blockers.
3. Redeploy or restart. The next push completes the indexes.

Do not drop the half-created tables by hand.

**Two replicas pushing at once (EKS):**
- Observed in 2 of 3 trials: one pod failed (`P2002`, or `relation "BankStatementImport" already exists`) and restarted
  into an in-sync push.
- The database ended fully migrated with no data lost every time.
- Expect one pod restart during the deploy.

**Old code on the new schema** works for:
- reads;
- creating bank accounts and statement lines;
- the old line-only reconcile;
- deleting a statement line that has no matches.

Linking a second bank account to an already-linked GL account fails with `P2002`, because the new unique index stays.

## 4. Rollback

**Never just redeploy or restart the previous build.** Its startup runs step 2 with the old schema and
`--accept-data-loss`. Verified on PostgreSQL 16, run on a copy of an upgraded ledger database, that push drops:
- `BankReconciliation` and `BankReconciliationEvent` (the sign-off audit trail);
- the match and import tables;
- `BankStatementLine.lockedAt`, `createdAt` and `source`;
- `BankAccount.currency`.

### Safe rollback
Deploy the previous image with this command instead of its default `CMD`, and keep `PLEROS_DB_PROVIDER=postgres` set:

```sh
sh -c "node scripts/apply-prisma-provider.mjs && npm run db:generate -w @pleros/web && PLEROS_SKIP_DB_MIGRATE=1 node scripts/start-server.mjs"
```

- **Render:** set it as the service's start command override.
- **EKS:** set it as the container `command`/`args`.

**Keep the override in place until you roll forward.** A plain restart without it pushes the old schema and drops the
tables above.

While rolled back:
- No schema push runs. The new tables, columns, indexes and all reconciliation data stay in the database untouched.
- The order-number backfill (step 3) does not run. That is harmless for a rollback.
- **Old code ignores period locks.** The retired line-only reconcile and Plaid sync can change lines inside signed-off
  periods. Tell finance not to edit those periods while rolled back. Check the affected periods after rolling forward.
- An old Plaid removal of a line that has match history fails on the foreign key (`Restrict`). That line stays.

**Roll forward:** deploy the new build with its normal command. Its push finds the schema in sync and changes nothing.

**Last resort:** restore the snapshot from section 2. This loses all reconciliation work done after the deploy, so first
export the sign-off PDFs and the `BankReconciliationEvent` rows.

### How the rollback was rehearsed
On disposable PostgreSQL 16.15 databases only, with the old code checked out from `origin/staging`:
1. The old build's startup migrate created the pre-feature schema, then synthetic legacy rows were added.
2. The new build's startup migrate ran, then a signed-off reconciliation, an event and locked lines were added.
3. The old checkout was reset to its image state: committed SQLite schemas and SQLite-generated clients.
4. The old checkout was started with `PLEROS_SKIP_DB_MIGRATE=1` alone. The server came up, but every database call failed,
   as section 1 describes.
5. The old checkout was started with the rollback command above, verbatim. The server came up, and the bootstrap admin
   could sign in, against the Postgres auth database. The old ledger client read and wrote the upgraded schema.
   Reconciliation rows, events and locked lines were all unchanged.
6. On a copy of the ledger database, the old startup migrate dropped the tables and columns listed above.
7. The new build's startup migrate ran again: nothing changed and every row was intact.

Rehearse the same sequence on staging, with its own approval, before relying on it in production.

## 5. Legacy statement lines without a dedupe key (open decision)

A CSV import skips rows it has already stored by matching the per-line `dedupeKey`. These lines have none:
- lines that existed before this deploy, which preflight check 3 counts;
- every line synced from Plaid, before and after this deploy. Plaid lines are identified by `reference`, the Plaid
  transaction id.

**Verified behavior**
(`legacy lines without a dedupe key (open gap)` in `apps/web/lib/server/bank-reconciliation-stabilization.test.ts`, on SQLite, PostgreSQL 16 and PostgreSQL 18):
- Importing a CSV of the same transactions **stores them again**: imported 2, skipped 0.
- The duplicated items can't be auto-matched. Sign-off is refused with "bank item(s) are not in the books", so a
  duplicate is never silently absorbed into a signed-off balance.
- There is no user-facing way to delete a statement line. A duplicate blocks that period's sign-off until someone applies
  a reviewed data fix.

This is a known gap, not acceptable steady-state behavior. A `todo` test records the intended behavior. **One of these
options must be chosen. None is implemented here, and the policy decision is open (owners: finance and the reviewer):**

**(a) Opening-date cutoff.** No code change. Each account is configured through the app.

What the cutoff does, from `cutoffFor` and `computeWorkspace` in `apps/web/lib/server/bank-reconciliation.ts`:
- Bank lines and GL lines dated before the account's `openingBalanceDate` are treated as cleared before reconciliation
  began. They are never listed as outstanding, so the old keyless lines and their re-imported copies can't meet.
- The book balance still sums **all** posted GL history of the linked cash account up to the period end.
- The bank balance is the statement closing balance that was entered.
- So the cutoff can't change a reported balance. What it changes is which items count as reconciling.

**Prerequisites. Finance must confirm each one for each account:**
1. **Nothing is outstanding at the cutoff.** Every GL entry dated before the cutoff must have cleared the bank before
   the cutoff. That means no uncleared cheques and no deposits in transit, confirmed against the last reconciliation
   done outside this system.
   - If this doesn't hold, the excluded item can't be listed. The first period shows a difference and can't be signed
     off: it fails closed and does not misstate anything.
   - The date can't be moved once a reconciliation exists for the account, because the API returns 409.
2. **The cutoff is after the account's last keyless line.** Check that with preflight check 3's per-account count and
   the line dates.
3. **The first reconciliation period starts on the cutoff date.** Its statement opening balance is the bank's balance
   on that date. A period starting earlier would leave out lines before the cutoff, and its statement total would
   disagree.
4. **The account is not Plaid-connected,** or nobody imports CSV statements for it. One source per account. Plaid
   lines have no dedupe key, so a CSV import duplicates them whatever the cutoff.
5. **Finance accepts the cost.** History before the cutoff is not reconciled in this workflow. It stays in the database
   unchanged, and nothing is deleted or edited.

**How to apply it:**
- Use `PATCH /api/v1/bank-accounts/:id` with `openingBalanceDate`. This needs `finance.write`.
- It is accepted only while the account has no reconciliations.
- It writes a `bank_account.updated` event with the before and after values.
- **It needs written finance approval per account.** Never apply it as a direct database edit.

**(b) Backfill dedupe keys.** A separate PR: a reviewed one-off script computes keys for legacy lines, with a dry run
and preflight counts. Lines whose description differs from the bank's CSV wording still won't match, and Plaid lines
need their own rule.

**(c) Void a duplicate line.** A separate PR: a permissioned, audited "void statement line" for open periods. It also
covers future mistakes made by operators.

Recommendation, pending the decision: (a) at launch, for accounts that meet every prerequisite. CSV import stays off
for accounts that don't. Add (c) as a follow-up.

## 6. Behavior changes to communicate

- `POST /api/v1/bank-accounts/:id/reconcile` now returns **410** for everyone.
  - Nothing in the repo still calls it.
  - External API consumers can't be found from the repo and will start receiving 410.
- `BankAccount.currentBalance` = the entered opening balance + lines reconciled by the retired flow.
  - The new matching never changes it, so it is **no longer a reconciled balance**.
  - Use the reconciliation's statement and adjusted balances instead.
- New permissions: `finance.reconcile`, `finance.reconcile.signoff` and `finance.reconcile.reopen`.
  - Creating, importing and matching need `finance.reconcile`.
  - Sign-off needs `finance.reconcile.signoff`; the module wildcard `finance.*` grants it.
  - Reopen needs an admin role or an explicit `finance.reconcile.reopen` grant. `finance.*` does not grant it.
- Posting a journal entry into a signed-off period returns **409**.
- A posting that collides with a sign-off running at the same time on the same bank account returns 409
  "retry posting". On Postgres this used to be a 500. Retrying re-checks the period lock.

## 7. Testing

### Default (SQLite)
```sh
cd apps/web
JWT_SECRET=<random> JWT_REFRESH_SECRET=<random> node ../../scripts/run-tests.mjs --import ./server/register-paths.mjs --import tsx \
  lib/server/bank-reconciliation.test.ts lib/server/bank-reconciliation-stabilization.test.ts lib/server/bank-statement-csv.test.ts
```
Each run uses fresh temporary SQLite files (`lib/server/test-support/isolated-databases.ts`).

### PostgreSQL (disposable local cluster only)
Use a throwaway cluster that only listens on localhost, for example `initdb` plus `pg_ctl` from the portable binaries
on a spare port. **Never** use a shared, staging or production server. Test against the production major version
(16) as well as any newer one.

```sh
# Generate Postgres clients in this checkout. This rewrites the 16 provider lines; restore them afterwards (last line).
PLEROS_DB_PROVIDER=postgres node scripts/apply-prisma-provider.mjs && npm run db:generate -w @pleros/web

export PLEROS_TEST_PG_ADMIN_URL='postgresql://<user>:<password>@127.0.0.1:<port>/postgres'   # refused unless localhost
(cd apps/web && JWT_SECRET=<random> JWT_REFRESH_SECRET=<random> node ../../scripts/run-tests.mjs \
  --import ./server/register-paths.mjs --import tsx lib/server/bank-reconciliation*.test.ts lib/server/bank-statement-csv.test.ts)

# Browser checks against the app on Postgres (e2e/bank-reconciliation-local/README.md)
BANKTEST_DEMO_PG_ADMIN_URL="$PLEROS_TEST_PG_ADMIN_URL" BANKTEST_DEMO_PASSWORD=<synthetic> \
  node e2e/bank-reconciliation-local/launch.mjs test --port <free port> --postgres

# Restore the committed providers and clients
PLEROS_DB_PROVIDER=sqlite node scripts/apply-prisma-provider.mjs && npm run db:generate -w @pleros/web
git status --short apps/web/prisma   # must be empty
```

How the PostgreSQL runs stay isolated:
- The backend tests create `pleros_itest_<random>_*` databases and drop only those.
- The browser harness does the same with `pleros_bankrecon_demo_<random>_*`.
- Neither prints the admin URL or passes it to the server.
- Without `PLEROS_TEST_PG_ADMIN_URL`, tests run with Postgres clients skip, as before.

On Postgres the posting/sign-off regression test is deterministic. It holds the sign-off's bank-account lock until the
competing posting has issued its own lock request **and** `pg_stat_activity` shows that posting waiting on a lock. The
test fails if the posting never reaches the lock.

### Upgrade and rollback rehearsal (disposable databases only)
Use one throwaway database per scenario:
1. Push the **pre-feature** ledger schema: `git show origin/staging:apps/web/prisma/ledger/schema.prisma` with the
   provider set to `postgresql`.
2. Insert synthetic legacy rows. For the failure path, add two bank accounts of one tenant on the same GL account.
3. Run the preflight with `BANK_RECON_PREFLIGHT_ENV=local`.
4. Push the new schema with `prisma db push --accept-data-loss`, exactly as startup does.
5. Compare row counts and sums before and after the push.
6. For the failure path, check which objects exist after the failed push, then fix the duplicate and push again.
7. For rollback, follow "How the rollback was rehearsed" in section 4, from a separate checkout of the previous release.
