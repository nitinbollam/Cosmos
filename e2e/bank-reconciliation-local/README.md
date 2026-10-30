# Local bank-reconciliation demo (disposable databases)

Runs the app against **16 brand-new SQLite databases** with one synthetic BANKTEST tenant, and optionally the browser checks of the reconciliation workflow. Your developer databases (`apps/web/.data`) are never opened for writing. They are hashed before and after a run to prove that.

## Run
Pick any synthetic password of 12+ characters. It is used only for the four demo users and is never stored in the repository.

```bash
# Git Bash / macOS / Linux
export BANKTEST_DEMO_PASSWORD='<synthetic password>'

# App only: open the printed URL; Ctrl+C stops it and deletes the databases
node e2e/bank-reconciliation-local/launch.mjs serve --port 4417

# App + browser checks (desktop 1440, phone 375/360, tablet 768); screenshots go to the folder you name
node e2e/bank-reconciliation-local/launch.mjs test --port 4417 --screenshots <folder outside the repo>
```

PowerShell: `$env:BANKTEST_DEMO_PASSWORD = '<synthetic password>'`, then run the same `node …` commands.

**Requirements**
- `npm ci` has been run.
- The Prisma clients in `apps/web/generated/` are generated for SQLite (the default).
- Google Chrome is installed: the checks use `channel: 'chrome'`, so no browser download is needed. Override with `BANKTEST_DEMO_BROWSER_CHANNEL=chromium` if Playwright's Chromium is installed.
- The port is free. The launcher refuses an occupied port, so it can never talk to another server.

**Users** (all with the password you set):

| User | Role |
|---|---|
| `banktest-accountant@example.test` | ACCOUNTANT: prepares and signs off |
| `banktest-preparer@example.test` | ACCOUNTANT with only `finance.read` and `finance.reconcile`: prepares, cannot sign off |
| `banktest-admin@example.test` | TENANT_ADMIN: can reopen |
| `banktest-sales@example.test` | SALES_REP: no finance access |

## What the launcher does
1. Creates `pleros-bankrecon-demo-XXXXXX` in the OS temp folder.
2. Sets all 16 `*_DATABASE_URL` values to SQLite files inside it, with `PLEROS_DB_PROVIDER=sqlite` and an empty `DATABASE_URL`.
3. Blanks every outbound-service key (Stripe, SendGrid, Twilio, AWS, AI providers, Plaid, VAPID, `ENCRYPTION_KEY`, …). It also blanks any other credential-like or endpoint-like **name** found in `apps/web/.env.local`; values are never read. Random JWT secrets are generated per run.
4. **Refuses to start** unless every database URL is a SQLite file inside that new folder, none points at `apps/web/.data`, and nothing remote is configured (`disposable-env.mjs`, `assertDisposableEnv`). The fixture and the Playwright config repeat this check.
5. Builds the 16 empty schemas with offline `prisma migrate diff --from-empty` SQL, then adds the synthetic tenant (`fixture.ts`):
   - 4 users, 7 GL accounts, 2 bank accounts
   - 11 posted and 2 draft journal entries, dated September/October 2026, so run any time after 2026-09-30
6. Starts the app server (`apps/client/server/index.ts`, the same as `npm run dev -w @pleros/client`). It does **not** use root `npm run dev`, which rewrites `.env.local` and `apps/client/.env`.
7. In `test` mode, runs `playwright.local.config.mts`. It has **no** `globalSetup` and no `webServer`; the repository's `e2e/global-setup.mjs` migrates and seeds the developer databases. Service workers are blocked, and every request to another host is aborted.
8. On exit:
   - stops the server
   - deletes only that temp folder (it refuses any other path)
   - checks that `apps/web/.data` is byte-identical

It never runs `db push`, `migrate`, `seed`, `--accept-data-loss` or the cleanup script.

## Files
| File | Purpose |
|---|---|
| `launch.mjs` | Entry point (serve / test), isolation, teardown |
| `disposable-env.mjs` | Builds and verifies the disposable environment; removes the temp folder |
| `fixture.ts` | Synthetic BANKTEST tenant; password from `BANKTEST_DEMO_PASSWORD` |
| `playwright.local.config.mts` | Browser config for these checks only (`*.local.ts`; the root config does not pick them up) |
| `bank-reconciliation.local.ts` | The browser checks |
| `fixtures/banktest-statement-2026-09.csv` | Valid synthetic September statement (8 rows) |
| `fixtures/banktest-statement-malformed.csv` | Five rows: bad date, 3-decimal amount, empty description, outside the period, one valid row |

## What the checks cover
- The workflow:
  - malformed and duplicate CSV
  - suggested and applied auto-matches, with ambiguity left open
  - 1:2 and 2:1 manual matches
  - unmatch with a reason, then rematch
- Sign-off and locking:
  - sign-off refused while the balances differ
  - fee booked through an adjusting entry
  - positive and negative role controls (preparer 403, sales rep 403, accountant signs off)
  - locked period: CSV, JSON, unmatch and backdated posting all 409; balances unchanged
- PDF download; reopen (accountant 403, no reason 400, admin 200).
- Stabilization findings:
  - F-1: the legacy "Account opening balance" tile stays $1,000.00 through matching
  - F-5: an item matched in October is not offered in September; sign-off is not blocked
  - F-6: failures of the period list, reconciliation, audit trail and GL accounts show an error with Retry; a 403 shows a permission message; an empty list shows the empty state
  - F-7: no page overflow, and every control reachable, at 375, 360 and 768 px with the tables shown
  - F-8: audit rows show names, never raw ids

Results are written to `<screenshots>/ui-results.json`.

## PostgreSQL run
The same checks, against 16 brand-new databases on a **disposable** Postgres cluster on this machine (never a shared, staging or production server):

```bash
# Clients must be generated for Postgres in this checkout (rewrites the provider lines; revert them after)
PLEROS_DB_PROVIDER=postgres node scripts/apply-prisma-provider.mjs && npm run db:generate -w @pleros/web
export BANKTEST_DEMO_PG_ADMIN_URL='postgresql://<user>:<password>@127.0.0.1:<port>/postgres'   # localhost only
node e2e/bank-reconciliation-local/launch.mjs test --port 4417 --postgres
```

- The launcher refuses a non-local host, and refuses unless the generated clients match the requested provider.
- Databases are named `pleros_bankrecon_demo_<random>_<name>`. They are created with `CREATE DATABASE`, which fails rather than reuse a name, and at exit only those are dropped.
- The maintenance URL is never passed to the server or the browser, and it is never printed.

The backend tests run on Postgres the same way: set `PLEROS_TEST_PG_ADMIN_URL` (localhost only) with Postgres-generated clients. Without it they skip, as before.

Afterwards, restore the committed providers: `PLEROS_DB_PROVIDER=sqlite node scripts/apply-prisma-provider.mjs && npm run db:generate -w @pleros/web`.

Deployment, rollback and upgrade-rehearsal instructions are in [`docs/BANK_RECONCILIATION_ROLLOUT.md`](../../docs/BANK_RECONCILIATION_ROLLOUT.md).
