# Pleros Platform — Features & Recent Additions

Comprehensive reference for the Pleros ERP/distribution platform: what the product does today, what was added in recent development, and how to run it locally.

> **Celestial AI knowledge base:** LLM-optimized documentation lives in [`docs/celestial/`](docs/celestial/) (indexed automatically by Celestial RAG). This file is the full human + machine reference; celestial docs use Q&A-friendly sections with keywords, workflows, and FAQ.

---

## Table of contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [User-facing surfaces](#user-facing-surfaces)
4. [Admin ERP modules](#admin-erp-modules)
5. [B2B storefront](#b2b-storefront)
6. [Mobile field apps (PWA)](#mobile-field-apps-pwa)
7. [API & backend capabilities](#api--backend-capabilities)
8. [Data model (Prisma / SQLite)](#data-model-prisma--sqlite)
9. [Analytics & finance](#analytics--finance)
10. [Branding, theme & UX](#branding-theme--ux)
11. [Recent additions (development log)](#recent-additions-development-log)
12. [Testing](#testing)
13. [Local development](#local-development)
14. [Demo accounts & seed data](#demo-accounts--seed-data)
15. [Known gaps / deferred work](#known-gaps--deferred-work)
16. [ERP industry comparison](#erp-industry-comparison)

---

## Overview

**Pleros** is a production-oriented ERP and distribution platform for SMB wholesalers and distributors. It covers inventory, orders, warehouse operations, purchasing, CRM, dispatch, compliance, finance, and a buyer-facing B2B portal — plus mobile apps for warehouse, delivery, and sales.

**Stack:** React 19 + Vite (UI), Express + Prisma + SQLite (API), npm workspaces monorepo.

**Single-port dev/prod:** UI and API both run on **http://localhost:4000**.

---

## Architecture

| Layer | Location | Notes |
|-------|----------|-------|
| **Client UI** | `apps/client` | Vite SPA, React Router, TanStack Query, Tailwind, Zustand |
| **API server** | `apps/web` | Express handlers in `apps/web/lib/server/`, entry `apps/web/server/api-router.ts` |
| **Dev server** | `apps/client/server/index.ts` | Vite middleware (HMR) + `/api/*` proxy to web API |
| **Shared packages** | `packages/*` | `@pleros/types`, `@pleros/ui`, `@pleros/web-gateway-client`, `@pleros/analytics-engine` |
| **Database** | `apps/web/.data/*.db` | 14 separate SQLite databases (one Prisma schema each) |
| **Seed & migrations** | `scripts/seed-db.ts`, `scripts/migrate-all.ts` | Multi-DB setup |

### Key routes (UI)

| Path prefix | Purpose |
|-------------|---------|
| `/` | Hub — links to Admin, Shop, Mobile |
| `/admin/*` | ERP admin console |
| `/catalog`, `/cart`, `/checkout`, `/orders`, `/quotes`, `/invoices`, `/account` | B2B buyer portal |
| `/m/*` | Mobile warehouse / delivery / sales |
| `/admin/celestial` | Full-page Celestial AI assistant (admin) |
| `/api/v1/*` | REST API |
| `/api/cashflow`, `/api/anomaly` | Analytics endpoints |

---

## User-facing surfaces

### 1. Admin console (`/admin`)

Full ERP back office with collapsible sidebar navigation, dashboard KPIs, and module pages for operations, finance, and settings.

**Auth:** `/admin/login` — tenant admin roles (`ADMIN`, etc.).

### 2. B2B shop (`/catalog`, …)

Buyer portal for catalog browsing, cart, checkout, order history, and quote requests. Scoped to the logged-in buyer’s CRM customer record.

**Auth:** `/login` — buyer roles (`STAFF`, `VIEWER`).

### 3. Mobile PWA (`/m/*`)

Lightweight field apps for warehouse picking/receiving, delivery routes/POD, and sales CRM activities. Installable via `manifest.webmanifest` (start URL: `/m/warehouse`).

**Auth:** `/m/login` — role-specific mobile users.

---

## Admin ERP modules

Navigation is defined in `apps/client/src/components/layout/sidebar.tsx`.

| Module | Route | Highlights |
|--------|-------|------------|
| **Dashboard** | `/admin` | Revenue/orders KPIs, cashflow forecast chart, low-stock alerts, recent orders, compliance badge |
| **Inventory** | `/admin/inventory` | SKU catalog, stock by warehouse, adjustments, transfers, spreadsheet import, low-stock alerts, barcode labels |
| **Orders** | `/admin/orders` | Order list, detail with saga timeline, confirm/cancel/fulfill, **returns (RMA)**, split shipments, invoice link |
| **Fulfillment** | `/admin/fulfillment` | Pick/pack tasks, assign picker, pick-all / pack / dispatch actions |
| **Warehouse** | `/admin/warehouse` | Pick tasks, receiving sessions, cycle counts, **wave picking**, **bin locations** |
| **Purchasing** | `/admin/purchasing` | Purchase orders, suppliers, receive goods |
| **Compliance** | `/admin/compliance` | MSA reports, tax exposure summary, batch tracking context |
| **CRM** | `/admin/crm` | Customers, leads, activities, import, lead conversion, contract/volume pricing |
| **Quotes** | `/admin/quotes` | Admin quote approval, counter-offers |
| **Dispatch** | `/admin/dispatch` | Delivery routes, stop reorder, driver assignment, map, proof of delivery |
| **Finance** | `/admin/finance` | **AR invoices**, AP (PO bills), 3-way match, bank recon, trial balance, cashflow chart, record payment |
| **POS** | `/admin/pos` | In-store checkout: register, customer, SKU cart, cash/card/check, receipt print |
| **Notifications** | `/admin/notifications` | Notification request inbox (SendGrid/Twilio when configured) |
| **Celestial** | `/admin/celestial` | Full-page AI copilot (also floating ✦ panel on all admin pages) |
| **Settings** | `/admin/settings` | Company profile, onboarding, team invites, warehouses, webhooks, feature flags, audit log, Stripe/MSA, billing plan |

**Navigation notes:** Sidebar order matches `SIDEBAR_NAV` in `sidebar.tsx`. Celestial sidebar link is hidden when the `celestial` feature flag is off. `/admin/customers` and `/admin/customers/:id` redirect to `/admin/crm` and `/admin/crm/customers/:id`.

**Shell components:** `dashboard-shell.tsx`, `sidebar.tsx`, `sidebar-icons.tsx`.

---

## B2B storefront

| Feature | Route / file | Description |
|---------|--------------|-------------|
| Catalog | `/catalog` | Search, filters, **contract pricing** for logged-in buyers, add to cart |
| Cart | `/cart` | Zustand cart store (`stores/cart.store.ts`, `lib/b2b-cart.ts`) |
| Checkout | `/checkout` | Multi-step shipping + payment (NET_TERMS, CARD via Stripe, etc.) |
| Orders | `/orders`, `/orders/:id` | Buyer order history, detail, **reorder** |
| Invoices | `/invoices`, `/invoices/:id` | Buyer AR list/detail, pay balance |
| Quotes | `/quotes`, `/quotes/new`, `/quotes/:id` | Create/list/view quotes; submit to order |
| Header | `components/shop-header.tsx` | Logo, nav (Catalog, Orders, Invoices, Quotes), cart badge, sign-in/out |

**Buyer scoping:** API uses `buyer-context.ts` to tie portal users to CRM `customerId` by email.

---

## Mobile field apps (PWA)

| App | Route | Features |
|-----|-------|----------|
| **Warehouse** | `/m/warehouse` | Task list, pick lines, receiving sessions |
| **Delivery** | `/m/delivery` | Routes, stops, mark failed, POD |
| **Sales** | `/m/sales` | Leads, customers, log activities |

**Layout:** `layouts/MobileLayout.tsx` — tab bar, logo header, safe-area padding.

**Offline / PWA:** `sw.js` precaches shell + Vite assets; `offline-queue.ts` registers Background Sync; failed/conflict syncs surface in the mobile banner with retry + discard (not silently dropped); install hint on `/m/login`; icons include 192×192.

---

## API & backend capabilities

**Router:** `apps/web/lib/server/native-router.ts` (mounted at `/api/v1/*`).

| Domain | Endpoints (summary) | Server module |
|--------|---------------------|---------------|
| Auth | login, register, refresh, me, logout | `auth.ts` |
| Tenants | profile, invites, plan, onboarding | `tenant.ts` |
| Users | list, deactivate | `users.ts` |
| Inventory | SKUs, warehouses, stock, adjust/receive/transfer, alerts | `inventory.ts` |
| Orders | CRUD, confirm, fulfill, cancel, payments, **returns**, invoice lookup | `orders.ts`, `order-orchestration.ts` |
| **Invoices** | list, get (buyer-scoped where applicable) | `invoices.ts` |
| **Quotes** | list, create, get, submit (buyer-scoped) | `quotes.ts` |
| CRM | customers, leads, activities, import | `crm.ts` |
| WMS | fulfillment tasks, receiving, cycle counts | `wms-*.ts` |
| Dispatch | routes, stops, driver location, POD | `dispatch.ts` |
| Purchasing | POs, suppliers, receive | `purchasing.ts` |
| Payments | Stripe authorize/capture/void/refund | `payments.ts` |
| Compliance | MSA reports, tax settings | `compliance-*.ts` |
| Finance | journal entries, chart of accounts, reports | `ledger.ts` |
| Analytics | KPIs, snapshots | `analytics.ts` |
| Webhooks | subscription CRUD, test | `webhooks.ts` |
| Notifications | list, send, provider status | `notifications.ts` |
| Features | `GET /features` — plan defaults + tenant overrides | `feature-flags.ts` |
| POS | `POST /pos/orders`, receipt | `pos.ts`, `pos-receipt.ts` |
| **Celestial** | `POST /celestial/chat`, `POST /celestial/chat/stream`, `GET /celestial/status`, `GET /celestial/conversations`, `GET /celestial/conversations/:id` | `celestial/` |

**Order saga:** `order-saga.ts` + `order-orchestration.ts` — orchestrated confirm → allocate → pick → ship pipeline.

---

## Data model (Prisma / SQLite)

14 schemas under `apps/web/prisma/`:

| Schema | Models (high level) |
|--------|---------------------|
| `auth` | User, Tenant |
| `tenant` | TenantOrganization, TenantInvite, WebhookSubscription, onboarding |
| `inventory` | SKU, Warehouse, StockLevel, StockLedgerEntry, StockReservation |
| `order` | Order, OrderLineItem, OrderSaga, **Invoice**, **CreditMemo** |
| `storefront` | **B2BQuote**, QuoteLine |
| `crm` | Customer, Lead, Activity |
| `wms` | FulfillmentTask, PickLine, ReceivingSession, CycleCount, … |
| `dispatch` | DeliveryRoute, RouteStop |
| `purchasing` | Supplier, PurchaseOrder, PurchaseOrderLine |
| `payment` | PaymentIntent, LedgerEntry |
| `ledger` | ChartAccount, JournalEntry, JournalLine |
| `compliance` | MSATenant, MSAReport, Batch, … |
| `notification` | NotificationRequest |
| `analytics` | DailyKpiSnapshot, **CelestialConversation**, **CelestialMessage** |

**Commands:** `npm run db:setup`, `db:generate`, `db:migrate`, `seed`.

---

## Analytics & finance

| Capability | Where |
|------------|-------|
| Dashboard KPIs | `GET /api/v1/analytics/kpis`, admin dashboard |
| KPI snapshots | `GET /api/v1/kpi/snapshots` — feeds revenue chart |
| Cashflow history | `GET /api/v1/analytics/cashflow-history` — weekly AR/AP collections (revenue proxy fallback) |
| Cashflow forecast | `POST /api/cashflow` — `@pleros/analytics-engine` EWMA (+ seasonal when history ≥ 8 weeks) |
| Demand forecast | `forecastDemandUsage` in analytics-engine; `GET /inventory/demand-plan` uses ledger daily series + EWMA |
| Anomaly detection | `POST /api/anomaly` (engine only; no admin UI yet) |
| Trial balance | Finance page + ledger API |
| **AR invoicing** | Auto-issue on ship, invoice list/detail, balance & overdue |
| **Credit memos** | Returns flow posts credit + optional GL |
| GL posting | `invoice-gl.ts` on invoice issue and credit memo |

---

## Branding, theme & UX

### Themes — Obsidian (default) & Aurora

Two switchable themes defined as `[data-theme]` token sets in `apps/client/src/globals-theme.css`:

| Theme | Style | Key colors |
|-------|-------|------------|
| **Obsidian** (default) | Matte black, minimal enterprise | bg `#09090B`, surfaces `#141416`–`#222226`, primary `#5B8DEF`, accent `#6B9FD4` |
| **Aurora** | Light wholesale (original palette) | Mauve `#DEC0F1` bg, Powder Petal `#EFD9CE` surfaces, primary `#7161EF` |

- **Switcher** (`components/theme-switcher.tsx`) in landing, admin, shop, and mobile headers plus all auth pages
- Persisted in `localStorage` (`pleros.theme`); applied pre-paint by an inline script in `index.html` (no flash)
- `lib/theme.ts` — storage, `applyTheme`, change events; meta `theme-color` updated per theme
- Typography: **Inter** (body + display), JetBrains Mono (code)

Styles split across `globals-theme.css`, `globals-admin.css`, `globals-shop.css`.

### Logo

| Asset / component | Path |
|-------------------|------|
| Source SVG | `pleros_logo.svg` (repo root) |
| React component | `apps/client/src/components/pleros-logo.tsx` |
| Variants | `full` (mark + wordmark), `mark`, `wordmark`; sizes `sm` / `md` / `lg` |
| Static fallbacks | `apps/client/public/pleros-logo.svg`, `pleros-mark.svg`, `pleros-logo-lockup.svg` |
| Favicons | `favicon-32.png`, `apple-touch-icon.png`, `pleros-icon-512.png` (from `scripts/generate-favicons.mjs`) |

Logo uses inline SVG (orbital rings + “Pleros” wordmark) for reliable rendering; lockup includes “DISTRIBUTION ERP” tagline on login screens.

### Admin shell UX

- Powder-petal sidebar on mauve canvas
- Icon-based nav (`sidebar-icons.tsx`) with active-state accent
- Collapsible desktop sidebar + **mobile slide-out drawer** (≤767px)
- Hamburger menu + logo mark in mobile header

### Text & contrast

- Semantic text tokens (`--c-heading`, `--c-text`, `--c-text-2`, `--c-text-3`)
- Tailwind utility remaps for light theme (`text-pleros-white` → dark heading color)
- Fixed white-on-light bugs across admin, shop, and mobile pages

---

## Recent additions (development log)

Summary of major work completed in the current development cycle.

### Tier 4 — Invoicing, returns & buyer quotes

| Item | What was added |
|------|----------------|
| **4.1 Invoicing & AR** | `Invoice` model; auto-issue on ship (`issueInvoiceForOrder`); `GET /invoices`, `GET /invoices/:id`, `GET /orders/:id/invoice`; Finance AR tab; GL posting via `invoice-gl.ts` |
| **4.2 Returns / RMA** | `POST /orders/:id/returns` — restock, credit memo, `returnedQty` on line items, `RETURNED` status; admin order detail “Process return” modal |
| **4.3 Buyer-scoped quotes** | Quote list/create/get filtered by buyer `customerRef`; wired in `native-router.ts` |
| **4.4 UI, seed & tests** | Finance/orders/quotes UI updates; `seedInvoices` in seed script; `tier4.test.ts` |

**Key files:** `apps/web/lib/server/invoices.ts`, `invoice-status.ts`, `invoice-gl.ts`, `apps/web/prisma/order/schema.prisma`.

### Theme overhaul

- Full purple palette applied across admin, shop, and mobile
- Updated Tailwind config, bento cards, charts, status badges, manifest theme-color
- Shop pages migrated from dark inline styles to theme CSS classes

### Logo & sidebar redesign

- Replaced legacy PNG/black-box logo with `pleros_logo.svg`-based design
- Inline SVG component with proper viewBox padding (no clipping)
- Sidebar: icon nav, brand footer, B2B storefront link, collapse control
- Regenerated PWA/favicon assets from orbital mark

### Text color & accessibility pass

- Darkened secondary text tokens for contrast on light backgrounds
- Global fixes for dashboard headers, checkout steps, warehouse tabs, fulfillment buttons
- `@pleros/ui` secondary button text fix
- Chart tooltip colors; mobile error/success message tokens

### Mobile-friendly layout

| Area | Changes |
|------|---------|
| **Admin** | Slide-out nav drawer, backdrop, 44px touch targets, safe-area insets, responsive table scroll, tighter page padding |
| **Shop** | Hamburger nav for Catalog/Orders/Quotes, compact header with logo |
| **Mobile PWA** | Logo in header, active tab styling, scrollable tabs, safe-area padding |
| **Viewport** | `viewport-fit=cover`; removed `maximum-scale=1.0` lock |

### Tier 5 — Finance automation & AP bills

| Item | What was added |
|------|----------------|
| **5.1 GL auto-posting** | `operations-gl.ts` — AR payment (Dr Cash / Cr AR), PO receipt (Dr Inventory / Cr AP), AP payment (Dr AP / Cr Cash); wired on order payment, PO receive, bill payment |
| **5.2 Vendor bills (AP)** | `VendorBill` + `VendorBillLine` models; auto-create/update on PO receive; `GET /bills`, `POST /bills/:id/payments`; Finance AP tab uses bills |
| **5.3 Chart accounts** | Seed adds **1100 Inventory**, **2100 Accounts Payable** |

**Key files:** `apps/web/lib/server/operations-gl.ts`, `ap-bills.ts`, `apps/web/prisma/purchasing/schema.prisma`.

### Tier 6 — Notifications, buyer invoices, contract pricing & reorder

| Item | What was added |
|------|----------------|
| **6.1 Notifications** | SendGrid/Twilio when env set; templates for order created/shipped, invoice issued, payment received, low stock; triggers in orders, invoices, dispatch, inventory |
| **6.2 Buyer invoices** | `/invoices`, `/invoices/:id` storefront pages; nav link; pay invoice (`POST /invoices/:id/payments`); invoice chip on order detail |
| **6.3 Contract pricing** | `CustomerPrice` CRM model; admin CRM customer tab; catalog resolves buyer contract prices; checkout validates prices server-side |
| **6.4 Reorder** | Reorder button on order list + detail → batch add to cart |

**Key files:** `notification-triggers.ts`, `pricing.ts`, `apps/client/src/pages/invoices/`, seed contract prices for Acme buyer.

### Tier 7 — Buyer polish, offline ops & quote approval

| Item | What was added |
|------|----------------|
| **7.1 Stripe invoice pay** | `POST /invoices/:id/pay/stripe` + card UI on buyer invoice detail |
| **7.2 Invoice PDF** | `GET /invoices/:id/pdf` — native PDF (pdfkit); `GET /invoices/:id/html` — print preview |
| **7.3 Reorder + contract prices** | `GET /orders/:id/reorder-lines` resolves current contract/list prices |
| **7.4 Offline sync** | Service worker (`public/sw.js`), queue replay (`offline-sync.ts`), mobile banner with conflict/failure UX (retry + discard) |
| **7.5 Low-stock PO prefill** | `/admin/purchasing?skuId=` pre-fills PO drawer with `reorderQty` |
| **7.6 Buyer account portal** | `/account` — credit, terms, address; `PATCH /customers/me` |
| **7.7 Quote approval** | Statuses OPEN → PENDING_APPROVAL → APPROVED → SUBMITTED; `/admin/quotes` |

**Key files:** `invoice-document.ts`, `offline-sync.ts`, `apps/client/src/pages/account/`, `apps/client/src/pages/admin/quotes/`.

### Tier 8 — Finance depth, B2B scale & platform

| Item | What was added |
|------|----------------|
| **8.1 COGS GL** | `postCogsJournal` on ship (Dr COGS / Cr Inventory); account 5000 |
| **8.2 Sales tax** | State jurisdiction rates in `compliance-tax.ts` (`computeOrderTax`) |
| **8.3 3-way match** | `BillMatchStatus` on vendor bills; `POST /bills/:id/match` |
| **8.4 Bank reconciliation** | `BankAccount` + statement lines; `/bank-accounts` API |
| **8.5 Order templates** | Buyer favorites; `GET/POST /order-templates` |
| **8.6 Volume pricing** | `VolumePriceBreak` CRM model; tier breaks in `pricing.ts` |
| **8.7 Quote counter-offers** | `QuoteCounterOffer` + accept flow |
| **8.8 Split shipments & ETA** | `OrderShipment` model; `GET /orders/:id/tracking` |
| **8.9 Saved payment methods** | `SavedPaymentMethod` + buyer API |
| **8.10 Wave picking & bins** | `PickWave`, `BinLocation` models + APIs |
| **8.11 Barcode labels** | `GET /skus/:id/label` printable HTML |
| **8.12 Platform** | Audit log, RBAC permissions map, feature flags, global search, public signup, POS registers |

**Key files:** `operations-gl.ts`, `bank-recon.ts`, `order-templates.ts`, `order-shipments.ts`, `wave-picking.ts`, `audit-log.ts`, `pos.ts`, `search.ts`, `signup.ts`.

### Tier 9 — Buyer UI polish & MSA automation

| Item | What was added |
|------|----------------|
| **9.1 Buyer order templates** | Account page: save cart as template, order again with contract prices |
| **9.2 Saved payment methods** | Account page: list/add/remove/default cards via `/saved-payment-methods` |
| **9.3 Bank reconciliation UI** | Finance → Bank recon tab: accounts, unreconciled lines, reconcile action |
| **9.4 MSA file storage** | `msa-storage.ts` persists MULTICAT files under `.data/msa/` |
| **9.5 MSA S3 / webhook upload** | `MSA_S3_BUCKET` or `MSA_UPLOAD_WEBHOOK_URL` env for external upload |
| **9.6 MSA EDI submit** | `POST /msa/reports/:id/submit` posts file to manufacturer `ediEndpoint` |
| **9.7 MSA cron automation** | `POST /msa/cron` generates, uploads, and auto-submits when configured |

**Key files:** `msa-storage.ts`, `compliance-msa.ts`, `apps/client/src/pages/account/page.tsx`, `apps/client/src/pages/admin/finance/page.tsx`.

### Tier 10 — Checkout, tracking & warehouse UI

| Item | What was added |
|------|----------------|
| **10.1 Checkout saved cards** | Checkout step 2: pick saved card or enter new; optional save-to-account after authorize |
| **10.2 Order tracking (buyer)** | Order detail: progress timeline, shipments with carrier links, delivery route ETA |
| **10.3 Wave picking UI** | Admin Warehouse → Wave picking tab: create/start/complete waves from pending tasks |
| **10.4 Bin locations UI** | Admin Warehouse → Bin locations tab: list/add/remove bins per warehouse |
| **10.5 Buyer polish** | Orders list: clickable rows, item counts; shop nav active state |

**Key files:** `apps/client/src/pages/checkout/page.tsx`, `apps/client/src/pages/orders/[id]/page.tsx`, `apps/client/src/pages/admin/warehouse/page.tsx`, `apps/client/src/components/shop-header.tsx`.

### Tier 11 — Fulfillment, pricing & compliance UI

| Item | What was added |
|------|----------------|
| **11.1 Seed shipments** | Demo SHIPPED/DELIVERED orders get UPS/FedEx tracking; split delivery shipment |
| **11.2 Admin split shipments** | Order detail: view/edit shipments, carrier + tracking, qty split across packages |
| **11.3 Volume pricing UI** | CRM customer detail: manage qty tier breaks via `/volume-prices` |
| **11.4 Quote counter-offers** | Buyer quote detail + admin quotes modal: propose/accept counters |
| **11.5 Audit log viewer** | Settings → Audit log tab with entity type filter |

**Key files:** `scripts/seed-db.ts`, `apps/client/src/pages/admin/orders/[id]/page.tsx`, `apps/client/src/pages/admin/crm/customers/[id]/page.tsx`, `apps/client/src/pages/quotes/[id]/page.tsx`, `apps/client/src/pages/admin/settings/page.tsx`.

### Tier 12 — AP match, labels & mobile waves

| Item | What was added |
|------|----------------|
| **12.1 3-way AP match UI** | Finance → Bills: match status column, filters, detail modal, re-run match |
| **12.2 Barcode label print** | SKU detail: print qty + opens printable HTML label (`GET /skus/:id/label`) |
| **12.3 Mobile wave picking** | `/m/warehouse` Waves tab + wave detail with start/complete and task links |
| **12.4 Seed polish** | Demo vendor bill MATCHED; seed pick wave for mobile warehouse demo |

**Key files:** `apps/client/src/pages/admin/finance/page.tsx`, `apps/client/src/pages/admin/inventory/[skuId]/page.tsx`, `apps/client/src/pages/m/warehouse/`.

### Tier 13 — Feature flags, buyer inbox, bin picking & POS checkout

| Item | What was added |
|------|----------------|
| **13.1 Feature flags UI** | Settings → Features tab: view plan defaults, toggle overrides via `PATCH /tenants/me` |
| **13.2 Buyer notification inbox** | Shop `/notifications` filtered by signed-in buyer email; seed order/invoice/payment messages |
| **13.3 Bin-directed picking** | Pick tasks include `binCode` from stock level locations; shown on mobile pick lines |
| **13.4 POS checkout UI** | Admin POS: register + customer + SKU cart + cash/card/check checkout |
| **13.5 Seed polish** | Bin A-01-01 on demo SKUs; walk-in customer; buyer notification rows |

**Key files:** `apps/client/src/pages/admin/settings/page.tsx`, `apps/client/src/pages/notifications/page.tsx`, `apps/web/lib/server/pick-bin-resolver.ts`, `apps/client/src/pages/admin/pos/page.tsx`, `scripts/seed-db.ts`.

### Tier 14 — Providers, prefs, bin path & receipts

| Item | What was added |
|------|----------------|
| **14.1 Notification providers UI** | Settings → Integrations: SendGrid/Twilio/webhook status via `GET /notifications/providers/status` |
| **14.2 Buyer notification prefs** | Account page toggles email/SMS/order/invoice alerts · `GET/PATCH /customers/me/notification-prefs` |
| **14.3 Wave bin pick path** | `GET /pick-waves/:id` returns `pickPath` sorted by bin · admin warehouse + mobile wave detail |
| **14.4 POS receipt print** | `GET /pos/orders/:id/receipt` HTML · Print receipt button after POS checkout |
| **14.5 Buyer retry + seed** | Failed notification retry in buyer inbox · demo SMS row and buyer prefs in seed |

**Key files:** `apps/web/lib/server/notification-provider-status.ts`, `apps/web/lib/server/customer-notification-prefs.ts`, `apps/web/lib/server/wave-picking.ts`, `apps/web/lib/server/pos-receipt.ts`, `apps/client/src/pages/account/page.tsx`.

### Tier 15 — Celestial AI assistant

| Item | What was added |
|------|----------------|
| **15.1 Celestial module** | `apps/web/lib/server/celestial/` — hybrid RAG + live-data tools + LLM synthesis (OpenRouter, Groq, Gemini, Ollama, mock) |
| **15.2 Knowledge base (RAG)** | `docs/celestial/*.md` (6 LLM-optimized files) + `PLATFORM_FEATURES.md` · chunked `##`/`###` retrieval with synonym scoring |
| **15.3 Chat API** | `POST /celestial/chat` (JSON or SSE via `Accept: text/event-stream` / `X-Celestial-Stream: 1`), `POST /celestial/chat/stream`, `GET /celestial/status` (`enabled` + provider/model) · gated by `celestial` feature flag |
| **15.4 Conversation history API** | `GET /celestial/conversations?surface=&limit=`, `GET /celestial/conversations/:id` — server-side thread restore across devices |
| **15.5 Buyer + admin UI** | Floating ✦ panel on shop/admin layouts · full page `/admin/celestial` · shared Zustand store `pleros-celestial-v1` |
| **15.6 Live data tools** | `get_my_orders`, `get_order_detail`, `list_my_invoices`, `search_catalog`, `list_my_quotes`, `list_warehouses`, `global_search`, `list_low_stock` — buyer-scoped where applicable |
| **15.7 Answer pipeline** | Intent detection → tools + doc retrieval → direct Markdown tables when data exists → LLM synthesis for how-to/general → doc fallback if LLM empty/fails (always returns an answer) |
| **15.8 Streaming UI** | SSE token streaming · `react-markdown` + GFM + syntax highlighting · contextual deep links from tool results |
| **15.9 Conversation store** | `CelestialConversation` / `CelestialMessage` in analytics DB · links/metadata on assistant messages · audit `celestial.chat` events |
| **15.10 Feature gating** | Settings → Features tab · sidebar Celestial link hidden when disabled · shop FAB hidden until login |

**LLM env vars:** `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, or `CELESTIAL_PROVIDER=ollama`. Set `CELESTIAL_MODEL` as needed. Runs in **mock mode** without keys (tool-backed structured answers still work).

**Knowledge base files (`docs/celestial/`):**

| File | Contents |
|------|----------|
| `01-platform-overview.md` | Platform summary, architecture, order lifecycle, demo accounts, glossary |
| `02-admin-modules.md` | Per-module how-to guides (Dashboard → Settings, POS, warehouse, finance) |
| `03-buyer-mobile.md` | B2B shop, account, invoices, mobile warehouse/delivery/sales apps |
| `04-api-finance-integrations.md` | REST API domains, AR/AP/GL workflows, Stripe, MSA, feature flags |
| `05-celestial-ai.md` | Celestial tools, API, env vars, example questions |
| `06-faq.md` | Common Q&A (POS, fulfillment, logins, local dev) |

**Key files:** `apps/web/lib/server/celestial/` (orchestrator, intent, tools, retrieval, compose, llm, prompts), `apps/client/src/components/celestial/`, `apps/client/src/stores/celestial-store.ts`, `apps/client/src/pages/admin/celestial/`.

### Tier 16 — ERP depth: lots/serials, putaway, labor, backorders, drop ship

| Item | What was added |
|------|----------------|
| **16.1 Lot/batch tracking** | `InventoryLot` model, FEFO allocation, SKU `trackLot` toggle, receiving + SKU detail UI |
| **16.2 Serial numbers** | `SerialUnit` register/reserve/ship lifecycle, SKU `trackSerial` toggle |
| **16.3 Directed putaway** | Bin suggestions, putaway tasks generated from receiving, admin confirm tab |
| **16.4 Labor / productivity** | `WmsLaborEvent` recorded on pick/receive/putaway; 7-day metrics tab (`GET /wms/labor/metrics`) |
| **16.5 Backorders** | Partial reservation, `BACKORDERED` status, `BackorderLine` queue, auto-fill on PO receipt (`GET /orders/backorders`) |
| **16.6 Drop shipping** | `DROP_SHIP` order lines, auto-PO per supplier, ship + invoice from admin order detail |

**Key files:** `apps/web/lib/server/inventory-lots.ts`, `inventory-serials.ts`, `wms-putaway.ts`, `wms-labor.ts`, `backorders.ts`, `drop-ship.ts`.

### Tier 17 — EDI, demand planning, landed cost & Postgres path

| Item | What was added |
|------|----------------|
| **17.1 EDI** | Trading partners (Settings → Integrations), inbound 850 → orders, outbound 810/856 documents, `OrderChannel.EDI` |
| **17.2 Demand planning** | EWMA on daily outbound ledger series (~70d); methods `USAGE_EWMA` / `USAGE_EWMA_SEASONAL` / `STATIC_REORDER`; `GET /inventory/demand-plan`, replenishment table shows method + EWMA/day |
| **17.3 Landed cost** | Freight/duty/other on PO allocated into inventory unit cost on receive; PO detail UI |
| **17.4 Postgres hardening** | `PLEROS_DB_PROVIDER=postgres`, `npm run db:setup:postgres`, dual-mode `migrate-all.ts`, `GET /health/db` |

**Key files:** `apps/web/lib/server/edi.ts`, `demand-planning.ts`, `landed-cost.ts`, `db-health.ts`, `scripts/setup-postgres.mjs`, `scripts/db-urls.mjs`.

### Tier 18 — Obsidian theme, theme switcher, landing & logout

| Item | What was added |
|------|----------------|
| **18.1 Obsidian theme** | New default matte-black enterprise theme; Inter typography; flat surfaces, hairline borders, steel-blue accent |
| **18.2 Theme switcher** | Obsidian ↔ Aurora toggle in landing/admin/shop/mobile headers and auth pages; persisted `pleros.theme`; pre-paint apply (no flash) |
| **18.3 Landing page** | `/` — role-based quick start, 6 feature modules, Celestial section, order-to-cash flow, workspace cards, demo credentials |
| **18.4 Logout everywhere** | Central `signOut()` (`lib/auth-session.ts`) — revokes server session (`POST /auth/logout`), clears tokens + B2B session; admin avatar menu, shop dropdown, mobile header, landing nav |
| **18.5 Celestial plain language** | Intent-aware plain-language answers for non-technical users; technical URLs/commands stripped unless asked |

**Key files:** `apps/client/src/globals-theme.css`, `lib/theme.ts`, `lib/auth-session.ts`, `components/theme-switcher.tsx`, `components/user-menu.tsx`, `pages/home/page.tsx`.

### Tier 5 — Deferred (not yet implemented)

- ~~GL auto-posting from all operational events~~ → **Tier 5.1 done** (ship/invoice, payment, receive, AP pay)
- ~~Formal AP bills entity~~ → **Tier 5.2 done**
- Production email/SMS notification providers → **Tier 6.1 done** (SendGrid/Twilio + console fallback)

---

## Testing

| Test file | Coverage |
|-----------|----------|
| `apps/web/lib/server/tier4.test.ts` | Invoice numbers, balances, overdue status |
| `apps/web/lib/server/tier2.test.ts` | Sales tax, dispatch, credit limit |
| `apps/web/lib/server/order-status.test.ts` | Order status transitions |
| `apps/web/lib/server/pick-line-status.test.ts` | WMS pick lines |
| `apps/web/lib/server/cycle-count-adjust.test.ts` | Cycle count |
| `apps/web/lib/server/po-receiving.test.ts` | PO receiving |
| `apps/web/lib/server/notification-provider.test.ts` | Notification stub |
| `apps/web/lib/server/celestial/intent.test.ts` | Celestial intent detection (orders, POS how-to, warehouses) |
| `apps/web/lib/server/celestial/compose.test.ts` | Direct compose tables, doc fallback replies |
| `apps/web/lib/server/celestial/retrieval.test.ts` | RAG chunk loading, POS/FAQ/warehouse retrieval |
| `packages/analytics-engine/src/cashflow.test.ts` | Cashflow forecast |
| `packages/analytics-engine/src/demand.test.ts` | Demand EWMA forecast |
| `apps/web/lib/server/cashflow-history.test.ts` | AR/AP weekly bucket helpers |
| `packages/web-gateway-client/src/resolve-gateway.test.ts` | API base URL |
| `apps/client/src/lib/admin-path.test.ts` | Admin path helpers |

```bash
npm run test          # all workspaces
npm run typecheck     # TypeScript
npm run lint          # ESLint (soft)
```

---

## Local development

### Prerequisites

- Node.js ≥ 20  
- npm ≥ 10  

### Quickstart

```bash
npm install
cp .env.example .env
npm run db:setup
npm run db:generate
npm run db:migrate
npm run seed
npm run dev
```

Open **http://localhost:4000**.

### Common commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite HMR + API on port 4000 |
| `npm run build` | Production build (all workspaces) |
| `npm run start -w @pleros/client` | Serve built SPA + API |
| `npm run seed` | Load demo tenant, SKUs, orders, invoices, etc. |
| `npm run db:migrate` | Run all Prisma migrations |
| `npm run sync:client` | Sync UI from legacy web app sources |
| `npm run format` | Prettier |

---

## Demo accounts & seed data

After `npm run seed`, the following accounts are available (demo tenant: **Pleros Demo Distributors**, slug `demo`):

| Role | Email | Password | URL |
|------|-------|----------|-----|
| **Admin** | `admin@pleros.local` | `admin1234` | http://localhost:4000/admin/login |
| **B2B buyer** | `buyer@acme-retail.com` | `buyer1234` | http://localhost:4000/login |
| **Driver** | `driver@pleros.local` | `driver1234` | http://localhost:4000/m/delivery |
| **Warehouse** | `warehouse@pleros.local` | `warehouse1234` | http://localhost:4000/m/warehouse |
| **Sales** | `sales@pleros.local` | `sales1234` | http://localhost:4000/m/sales |

**Seed includes:** catalog SKUs, sample orders (various statuses), open quote, POs, fulfillment tasks, dispatch route, MSA report, journal entry, **seed invoices**, KPI snapshots for dashboard charts.

---

## ERP industry comparison

See **[ERP_FEATURE_GAP.md](ERP_FEATURE_GAP.md)** for a full comparison of Pleros vs established wholesale/distribution ERP platforms (NetSuite, Business Central, Acumatica, Prophet 21, etc.) — module coverage, gaps, and suggested roadmap priorities.

---

## Known gaps / deferred work

Documented in `MISSING.md`, `ERP_FEATURE_GAP.md`, and backlog:

- Legacy Nest/Expo/Python microservices not on this branch
- Redis event bus (stub in `event-bus.ts`; set `REDIS_URL` for production wiring)
- MSA automation depends on env (`MSA_S3_BUCKET`, `MSA_UPLOAD_WEBHOOK_URL`, manufacturer `ediEndpoint`); local archive + cron (`POST /msa/cron`) implemented in Tier 9
- Postgres unified dev path (local uses SQLite; production URL helpers in `env.ts`)

---

## File index (quick reference)

| Area | Primary paths |
|------|----------------|
| UI router | `apps/client/src/router.tsx` |
| Admin pages | `apps/client/src/pages/admin/` |
| Shop pages | `apps/client/src/pages/catalog/`, `cart/`, `checkout/`, `orders/`, `quotes/` |
| Mobile pages | `apps/client/src/pages/m/` |
| Theme | `apps/client/src/globals-theme.css` |
| Logo | `apps/client/src/components/pleros-logo.tsx`, `pleros_logo.svg` |
| Sidebar / shell | `apps/client/src/components/layout/` |
| API router | `apps/web/lib/server/native-router.ts` |
| Celestial AI | `apps/web/lib/server/celestial/`, `apps/client/src/components/celestial/`, `apps/client/src/stores/celestial-store.ts` |
| Celestial knowledge base | `docs/celestial/*.md` (RAG source; indexed by `retrieval.ts`) |
| ERP industry gap analysis | `ERP_FEATURE_GAP.md` |
| Invoices / returns | `apps/web/lib/server/invoices.ts` |
| Quotes | `apps/web/lib/server/quotes.ts` |
| POS | `apps/web/lib/server/pos.ts`, `apps/client/src/pages/admin/pos/` |
| Seed | `scripts/seed-db.ts` |
| Migrations | `scripts/migrate-all.ts` |

---

*Last updated: May 2026 — reflects Tier 15 Celestial AI (RAG knowledge base, conversation API, streaming UI, feature gating).*
