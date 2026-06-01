# API, Finance Workflows, and Integrations (LLM Knowledge Base)

Reference for API domains, finance automation, analytics, and platform integrations.

**Keywords:** API, REST, endpoints, finance, GL, AR, AP, webhooks, Stripe, notifications, analytics, feature flags

---

## REST API overview

**Base path:** `/api/v1/*` via `apps/web/lib/server/native-router.ts`

All endpoints require tenant-scoped auth (JWT/session) unless noted (public signup).

| Domain | Key endpoints | Server module |
|--------|---------------|---------------|
| Auth | login, register, refresh, me, logout | `auth.ts` |
| Tenants | profile, invites, plan, onboarding, feature flags | `tenant.ts` |
| Users | list, deactivate | `users.ts` |
| Inventory | SKUs, warehouses, stock, adjust/receive/transfer, alerts, labels | `inventory.ts` |
| Orders | CRUD, confirm, fulfill, cancel, payments, returns, tracking | `orders.ts`, `order-orchestration.ts` |
| Invoices | list, get, payments, PDF, Stripe pay | `invoices.ts` |
| Quotes | list, create, get, submit, counter-offers | `quotes.ts` |
| CRM | customers, leads, activities, contract/volume pricing | `crm.ts` |
| WMS | fulfillment tasks, receiving, cycle counts, waves, bins | `wms-*.ts`, `wave-picking.ts` |
| Dispatch | routes, stops, driver location, POD | `dispatch.ts` |
| Purchasing | POs, suppliers, receive | `purchasing.ts` |
| Payments | Stripe authorize/capture/void/refund | `payments.ts` |
| POS | `POST /pos/orders`, receipt | `pos.ts`, `pos-receipt.ts` |
| Compliance | MSA reports, tax settings, cron | `compliance-*.ts` |
| Finance / GL | journal entries, chart of accounts, trial balance, bank recon | `ledger.ts`, `bank-recon.ts` |
| Analytics | KPIs, snapshots | `analytics.ts` |
| Search | global search (orders, customers, SKUs, quotes) | `search.ts` |
| Webhooks | subscription CRUD, test | `webhooks.ts` |
| Notifications | list, send, provider status | `notifications.ts` |
| Celestial | `POST /celestial/chat`, stream, status | `celestial/` |
| MSA | reports, submit, cron | `compliance-msa.ts`, `msa-storage.ts` |

**Analytics (non-v1):** `POST /api/cashflow`, `POST /api/anomaly` — `@cosmos/analytics-engine`.

---

## Accounts Receivable (AR) workflow

**Keywords:** AR, invoice, accounts receivable, customer bill, payment received

1. Order ships → **invoice auto-issued** (`issueInvoiceForOrder`)
2. GL posts: Dr AR / Cr Revenue (+ tax lines)
3. Invoice appears in Finance AR tab and buyer `/invoices`
4. Buyer or admin records payment → Dr Cash / Cr AR
5. Returns create **credit memo** with optional GL reversal

**Statuses:** Open, partial paid, paid, overdue (based on terms and balance).

---

## Accounts Payable (AP) workflow

**Keywords:** AP, vendor bill, accounts payable, 3-way match, PO receive

1. PO created for supplier
2. Goods **received** → inventory incremented, **vendor bill** auto-created
3. GL posts: Dr Inventory / Cr AP
4. **3-way match** compares PO, receipt, bill (`BillMatchStatus`, `POST /bills/:id/match`)
5. Pay bill in Finance AP → Dr AP / Cr Cash

Finance UI: Bills tab with match status filters and detail modal (Tier 12).

---

## General Ledger and COGS

**Keywords:** GL, general ledger, journal entry, trial balance, COGS, chart of accounts

**Seed accounts include:** Cash, AR, Inventory (1100), AP (2100), Revenue, COGS (5000).

**Auto-posting events (`operations-gl.ts`, `invoice-gl.ts`):**
- Invoice issue, payment received, PO receive, AP payment, ship COGS

**Trial balance:** Finance page + ledger API.

---

## Contract and volume pricing

**Keywords:** contract pricing, volume pricing, tier break, customer price

- **Contract pricing:** Admin sets per-SKU prices on CRM customer detail; catalog and checkout resolve buyer-specific prices
- **Volume pricing:** Quantity tier breaks on customer; `pricing.ts` applies best break at checkout
- Server validates prices on checkout (buyer cannot tamper with client-side prices)

---

## Order templates and reorder

**Keywords:** reorder, order template, favorites, order again

- **Reorder** from order list/detail adds prior lines to cart with current contract prices
- **Order templates** on `/account` — save cart as named template, one-click reorder

---

## Split shipments and tracking

**Keywords:** split shipment, tracking, carrier, UPS, FedEx, ETA

- `OrderShipment` model — multiple packages per order with carrier + tracking number
- Admin order detail: view/edit shipments, split qty across packages
- Buyer order detail: progress timeline + carrier tracking links
- API: `GET /orders/:id/tracking`

---

## Wave picking and bin locations

**Keywords:** wave picking, pick wave, bin location, pick path, directed picking

- **Bin locations** defined per warehouse in Admin → Warehouse → Bin locations
- Stock levels store `binCode`; pick lines show bin for directed picking
- **Pick waves** group pending tasks; `GET /pick-waves/:id` returns bin-sorted **pick path**
- Admin Warehouse and mobile `/m/warehouse` both support waves

---

## Feature flags

**Keywords:** feature flags, plan, tier, celestial flag, enable feature

**Route:** Settings → Features tab

Tenants have plan defaults plus overrides via `PATCH /tenants/me`. Features include `celestial` (AI assistant), and module toggles per tier.

**Celestial** requires `celestial` feature flag enabled for the tenant.

---

## Notifications and integrations

**Keywords:** SendGrid, Twilio, email, SMS, webhook, notification provider

**Providers:** SendGrid (email), Twilio (SMS) when env configured; console/webhook fallback.

**Settings → Integrations:** shows provider status via `GET /notifications/providers/status`.

**Triggers:** order created/shipped, invoice issued, payment received, low stock (via `notification-triggers.ts`).

**Buyer prefs:** `/account` + `GET/PATCH /customers/me/notification-prefs`.

---

## Webhooks

**Keywords:** webhook, subscription, event, integration

Settings → Webhooks: CRUD webhook subscriptions, test delivery. Used for external system integration.

---

## Stripe payments

**Keywords:** Stripe, card payment, authorize, capture, saved payment method

- B2B checkout card payments via Stripe
- Buyer invoice pay with Stripe (`POST /invoices/:id/pay/stripe`)
- Saved payment methods on account and checkout
- Settings configures Stripe keys for tenant

---

## MSA compliance automation

**Keywords:** MSA, manufacturer, EDI, S3, compliance report, cron

- Generate MSA reports from sales/compliance data
- File storage: local `.data/msa/` or `MSA_S3_BUCKET` / `MSA_UPLOAD_WEBHOOK_URL`
- EDI submit: `POST /msa/reports/:id/submit` to manufacturer `ediEndpoint`
- Automation: `POST /msa/cron` generates, uploads, and submits when configured

---

## Global search (admin)

**Keywords:** global search, find customer, lookup order, search SKU

Admin global search queries orders, customers, SKUs, and quotes by term. Used by Celestial `global_search` tool when user asks to find a specific entity.

**API:** `search.ts`.

---

## Audit log

**Keywords:** audit log, who changed, compliance trail

Settings → Audit log tab. Records actions like `celestial.chat`, order changes, etc. Filter by entity type.

---

## Known limitations

**Keywords:** gaps, limitations, not implemented, deferred

From platform backlog (`MISSING.md`):
- Redis event bus is stubbed (set `REDIS_URL` for production)
- Invoice PDF is print-ready HTML, not native PDF library
- Local dev uses SQLite; production may use Postgres via `env.ts`
- Legacy Nest/Expo/Python microservices not on this branch
