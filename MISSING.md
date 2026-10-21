# Notes (@pleros/web)

All product code lives in **`apps/web`**. There are no Nest, Expo, or Python service folders on this branch. Last reviewed 2026-10-21.

## Infra status

| Feature | Status |
|---------|--------|
| MSA S3 upload / EDI cron | Done: local archive, webhook/S3 env, EDI POST, `/msa/cron` automation |
| Redis event bus | **Stub.** `event-bus.ts` logs to console (or `redis-stub` when `REDIS_URL` is set) and does not connect to Redis |
| Rate limiter and session cache | Per-process, in memory. Needs Redis before running multiple replicas |
| Real notification providers | SendGrid/Twilio when env set; console/webhook fallback |
| POS registers | Done: `/admin/pos` + `POST /api/v1/pos/orders` |
| Service worker offline sync | Done: `sw.js` shell-first `/m/*`, asset precache, SWR API GETs, queue replay / Background Sync |
| Postgres unified dev path | CI/production path via `env.ts`; local dev uses SQLite. Concurrency tests only pass on Postgres, so run `npm run prod:preflight` against Postgres before merging |
| Native PDF invoices | Done: `GET /invoices/:id/pdf` (pdfkit); print preview at `/invoices/:id/html` |
| Posting outbox | Done for invoice, extension, COGS, COGS reversal, credit memo, AR payment and AP payment journals, plus deferred work (invoice sync, credit release, backorder fill, delivery advance, order cancel) |
| Code-health gates | Done: lint rejects new swallowed errors, growth in `toFixed` / `new Decimal(x)` sites, absolute stock writes, and default tax rates |
| Manufacturing | Done: BOMs, assembly and disassembly orders, guarded stock updates |

## Still to build

| Item | Notes |
|------|-------|
| Redis | Real event bus, shared rate limiter and session cache |
| Outbox: remaining postings | PO receipt, expense and gift-card journals still post outside the outbox |
| Tenant scoping | `TENANT_SCOPE_MODE` is `audit`; move to `enforce` after the cross-tenant route matrix, a lint rule banning raw client imports, and Postgres row-level security |
| Money handling | 84 `toFixed` and 131 `new Decimal(x)` sites are baselined, not migrated; target is `--money=strict` ([`docs/SWALLOWED_ERRORS.md`](docs/SWALLOWED_ERRORS.md)) |
| Reconciliation and tax backfill | Run `npm run reconcile` and `npm run tax:backfill` as dry runs after deploy. Do not run `npm run tax:reclass -- --apply` in production until finance approves the totals and posting date |
| Cost-bearing layers | Costing method, transfers and returns carrying cost (Kapp wave 2) |
| Kapp port | Wave 1: multi-unit packaging, then the configurable tax engine (needs excise bases per state). Later waves: transfers, purchase returns, credit wallet, tier pricing, reorder suggestions, change history, invoice OCR |
| Accounting package sync | QuickBooks Online or Xero, not started |
| Multi-channel sync | Amazon, Walmart, eBay, Shopify: spec'd, not built |
| Payroll | Provider not chosen (Check, Gusto Embedded, Zeal, Deel) |
| Tenant-to-tenant marketplace | Planned, not built |
