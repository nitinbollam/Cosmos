# Notes (@pleros/web)

All product code lives in **`apps/web`**. There are no Nest, Expo, or Python service folders on this branch. (There is no Expo mobile app, but the server can already send Expo push notifications to one, alongside browser push.)

Every line below was checked against the code on 2026-10-21. Where a status is "not built", the check was that no model, module or route for it exists.

## Built

| Feature | Where |
|---------|-------|
| MSA S3 upload / EDI cron | Local archive, webhook/S3 env, EDI POST, `/msa/cron` automation (`msa-storage.ts`) |
| Notification providers | SendGrid, Twilio, push, webhook; console fallback (`notification-provider.ts`) |
| POS registers | `/admin/pos` + `POST /api/v1/pos/orders` |
| Service worker offline sync | `apps/client/public/sw.js`: shell-first `/m/*`, asset precache, SWR API GETs, queue replay / Background Sync |
| Native PDF invoices | `GET /invoices/:id/pdf` (pdfkit); print preview at `/invoices/:id/html` |
| Rate limiting | Database-backed (`RateLimitBucket`, one atomic upsert), so it is correct across replicas |
| Posting outbox | Invoice, extension, COGS, COGS reversal, credit memo, AR payment and AP payment journals, plus deferred work (invoice sync, credit release, backorder fill, delivery advance, order cancel) |
| Code-health gates | Lint rejects new swallowed errors, growth in `toFixed` / `new Decimal(x)` sites, absolute stock writes, and default tax rates |
| Tenant scoping | `withTenantScope` on every client; modes `off` / `audit` / `enforce` / `strict`, default `audit` ([`docs/TENANT_SCOPE.md`](docs/TENANT_SCOPE.md)) |
| Reconciliation | `npm run reconcile`, findings stored in `ReconciliationFinding` |
| Manufacturing | BOMs, assembly and disassembly orders, guarded stock updates |
| Tenant-to-tenant marketplace | Profiles, fixed-price and auction listings, bids, orders, payments, ratings, disputes, messages, saved searches, shipment requests |
| Shopify channel sync | `sales-channels/shopify.ts` with fulfillment sync and eligibility rules |

## Not built, or only partly

| Item | State |
|------|-------|
| Redis | `event-bus.ts` is a stub: with `REDIS_URL` set it logs and reports `redis-stub`, and there is no Redis client dependency. Compose, Kubernetes and Terraform already define Redis. The session cache is a per-process `Map` with a 60-second TTL, which is fine for correctness but not shared |
| Outbox: remaining postings | PO receipt (`postPoReceiptJournal`), expense approval and paid, and gift-card issue and redeem journals still post directly instead of through the outbox |
| Tenant scoping rollout | Still in `audit`. To do: wrap workers, public routes and webhooks in `runWithTenant` / `runUnscoped`, work through the 20 flagged sites in `docs/TENANT_SCOPE.md`, then move to `enforce` and `strict`. Postgres row-level security does not exist |
| Money handling | 84 `toFixed` and 152 `new Decimal(x)` sites are baselined, not migrated; the target is `--money=strict` ([`docs/SWALLOWED_ERRORS.md`](docs/SWALLOWED_ERRORS.md)) |
| Marketplace shipping | Kalafleet booking is manual: ops enters the reference (`bookMarketplaceShipment`); there is no Kalafleet API call |
| Other sales channels | Amazon, Walmart and eBay: not built (only Shopify) |
| Accounting package sync | QuickBooks / Xero: not built |
| Payroll | Not built; provider not chosen (Check, Gusto Embedded, Zeal, Deel) |
| Multi-unit packaging | Not built: a SKU has one `unitOfMeasure` text field |
| Configurable tax engine | Not built: `compliance-tax.ts` uses a fixed table of state rates |
| Stock transfers | `transferStock` moves stock in one step; no in-transit state, no cost carried |
| Purchase returns and vendor credits | Not built: no return-to-vendor document or vendor credit |
| Customer groups and targeted promotions | Not built: pricing has `CustomerPrice` and `VolumePriceBreak`, and `Discount` is code-based |
| Customer wallet | Not built: credit limits and `CreditApplication` exist, but no wallet, overpayment balance or bounced-check handling |
| Costing method | COGS uses the current `SKU.cost` (`computeOrderCogs`), so a cost change rewrites past margin; landed cost exists for receipts |
| Smarter reorder suggestions | `demand-planning.ts` forecasts from ledger movements only |
| Field-level change history | `AuditEvent` records actions, not field diffs |
| Supplier invoice OCR | Not built |

## Your actions after deploy

- Switch the GitHub default branch from `staging` to `main`.
- Run `npm run reconcile -- --tenant <id> --dry` and `npm run tax:backfill` as dry runs.
- Do not run `npm run tax:reclass -- --apply` in production until finance approves the totals and posting date.
