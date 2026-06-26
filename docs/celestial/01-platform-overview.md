# Pleros Platform Overview (LLM Knowledge Base)

This document helps Celestial and other AI assistants answer questions about Pleros — a wholesale ERP and distribution platform for SMB distributors.

**Keywords:** Pleros, ERP, distribution, wholesale, B2B, platform overview, what is Pleros, how Pleros works, modules, features, plain language

---

## How Pleros works (plain language)

Pleros is software that helps a **wholesale or distribution business** run day to day — from taking orders to getting paid.

**The big picture:**

1. **Customers order products** — Business buyers use an online catalog and checkout; your team can also enter orders in the office or ring up walk-in sales at the **Point of Sale** counter.
2. **You fulfill from the warehouse** — Staff pick items (often guided by bin locations), pack orders, and mark them ready to ship. Mobile apps help warehouse teams scan and pick on the floor.
3. **You deliver** — Drivers follow routes, update stops, and capture proof of delivery on a phone app.
4. **You get paid** — Invoices go out when orders ship; customers pay online or on terms. Finance tracks money in (customer invoices) and money out (supplier bills).
5. **You stay stocked** — Inventory shows what you have at each warehouse; purchasing brings in more from suppliers when you receive goods.

**Who uses what:**

| Role | What they use Pleros for |
|------|--------------------------|
| **Office / admin staff** | Orders, inventory, purchasing, customers, finance, settings |
| **Warehouse team** | Picking, receiving shipments, cycle counts (phone or tablet app) |
| **Drivers** | Delivery routes and proof of delivery (phone app) |
| **Field sales** | Leads, customers, and visit notes (phone app) |
| **B2B buyers** | Browse catalog, place orders, pay invoices, track shipments |

**Celestial (this assistant)** can answer questions about how features work and look up your live orders, stock, and warehouses — in everyday language.

---

## What is Pleros?

Pleros is a production-oriented **ERP and distribution platform** for small and medium wholesalers. It covers the full wholesale lifecycle: product catalog, inventory and warehouses, sales orders, fulfillment and picking, purchasing, CRM, delivery dispatch, compliance (MSA), finance (AR/AP/GL), a buyer-facing B2B portal, mobile field apps, and an AI assistant called **Celestial**.

**Stack:** React 19 + Vite (UI), Express + Prisma + SQLite (API), npm workspaces monorepo.

**Single-port dev:** UI and API both run on **http://localhost:4000**.

**Demo tenant:** Pleros Demo Distributors (slug `demo`).

---

## Architecture and tech stack

| Layer | Location | Purpose |
|-------|----------|---------|
| Client UI | `apps/client` | Vite SPA, React Router, TanStack Query, Tailwind, Zustand |
| API server | `apps/web` | Express handlers in `apps/web/lib/server/` |
| Dev server | `apps/client/server/index.ts` | Vite HMR + `/api/*` proxy |
| Shared packages | `packages/*` | types, UI, analytics-engine, web-gateway-client |
| Database | `apps/web/.data/*.db` | 14 separate SQLite databases (one Prisma schema each) |

**API base:** `/api/v1/*` mounted from `native-router.ts`.

**Analytics endpoints:** `/api/cashflow`, `/api/anomaly`.

---

## User surfaces and URLs

Pleros has four main surfaces. Each has its own login and role model.

| Surface | URL prefix | Who uses it | Login |
|---------|------------|-------------|-------|
| **Hub** | `/` | Everyone | Links to Admin, Shop, Mobile |
| **Admin ERP** | `/admin/*` | Staff (ADMIN, etc.) | `/admin/login` |
| **B2B Shop** | `/catalog`, `/cart`, `/checkout`, `/orders`, `/quotes`, `/invoices`, `/account` | Buyer portal users (STAFF, VIEWER) | `/login` |
| **Mobile PWA** | `/m/warehouse`, `/m/delivery`, `/m/sales` | Warehouse, driver, sales field users | `/m/login` |

Admin sidebar navigation is defined in `apps/client/src/components/layout/sidebar.tsx`.

---

## Admin sidebar modules (quick reference)

| Module | Route | Purpose |
|--------|-------|---------|
| Dashboard | `/admin` | KPIs, cashflow chart, low-stock alerts, recent orders |
| Inventory | `/admin/inventory` | SKUs, stock levels, adjustments, transfers, import |
| Orders | `/admin/orders` | Order list, detail, confirm/cancel/fulfill, returns (RMA) |
| Fulfillment | `/admin/fulfillment` | Pick/pack tasks, assign picker, dispatch actions |
| Warehouse | `/admin/warehouse` | Pick tasks, receiving, cycle counts, wave picking, bin locations |
| Purchasing | `/admin/purchasing` | Purchase orders, suppliers, receive goods |
| Compliance | `/admin/compliance` | MSA reports, tax exposure, batch tracking |
| CRM | `/admin/crm` | Customers, leads, activities, contract pricing |
| Quotes | `/admin/quotes` | Admin quote approval workflow |
| Dispatch | `/admin/dispatch` | Delivery routes, stops, driver assignment, POD |
| Finance | `/admin/finance` | AR invoices, AP bills, trial balance, bank recon, payments |
| POS | `/admin/pos` | In-store point-of-sale checkout (register, customer, cart) |
| Celestial | `/admin/celestial` | Full-page AI assistant |
| Settings | `/admin/settings` | Company, team, warehouses, webhooks, feature flags, audit log |

---

## Order status lifecycle

Orders move through these statuses in Pleros:

1. **PENDING** — Created, awaiting confirmation
2. **CONFIRMED** — Accepted; inventory may be allocated
3. **PROCESSING** — Being picked in warehouse
4. **PACKED** — Packed and ready to ship
5. **SHIPPED** — Shipped with carrier tracking (may have split shipments)
6. **DELIVERED** — Delivered to customer
7. **CANCELLED** — Cancelled before fulfillment
8. **RETURNED** — Return/RMA processed (partial or full)

**Order saga:** `order-saga.ts` orchestrates confirm → allocate → pick → ship pipeline.

Admin actions: confirm, cancel, fulfill on `/admin/orders/:id`. Returns via **Process return** modal posts credit memo and restocks.

---

## Data model (14 SQLite databases)

| Schema | Key models |
|--------|------------|
| auth | User, Tenant |
| tenant | TenantOrganization, invites, webhooks, onboarding |
| inventory | SKU, Warehouse, StockLevel, StockLedgerEntry, StockReservation |
| order | Order, OrderLineItem, OrderSaga, Invoice, CreditMemo, OrderShipment |
| storefront | B2BQuote, QuoteLine, QuoteCounterOffer |
| crm | Customer, Lead, Activity, CustomerPrice, VolumePriceBreak |
| wms | FulfillmentTask, PickLine, ReceivingSession, CycleCount, PickWave, BinLocation |
| dispatch | DeliveryRoute, RouteStop |
| purchasing | Supplier, PurchaseOrder, VendorBill |
| payment | PaymentIntent, SavedPaymentMethod |
| ledger | ChartAccount, JournalEntry, JournalLine, BankAccount |
| compliance | MSATenant, MSAReport, Batch |
| notification | NotificationRequest |
| analytics | DailyKpiSnapshot, CelestialConversation |

**Setup commands:** `npm run db:setup`, `db:generate`, `db:migrate`, `seed`.

---

## Demo accounts (after `npm run seed`)

| Role | Email | Password | URL |
|------|-------|----------|-----|
| Admin | `admin@pleros.local` | `admin1234` | `/admin/login` |
| B2B buyer (Acme Retail) | `buyer@acme-retail.com` | `buyer1234` | `/login` |
| Driver | `driver@pleros.local` | `driver1234` | `/m/delivery` |
| Warehouse | `warehouse@pleros.local` | `warehouse1234` | `/m/warehouse` |
| Sales | `sales@pleros.local` | `sales1234` | `/m/sales` |

Seed includes demo SKUs, orders (multiple statuses), invoices, quotes, POs, fulfillment tasks, dispatch route, MSA report, warehouses (MAIN, EAST), bin locations, pick waves, and KPI snapshots.

---

## Local development quickstart

```bash
npm install
cp .env.example .env
npm run db:setup && npm run db:generate && npm run db:migrate && npm run seed
npm run dev
```

Open **http://localhost:4000**. `npm run dev` syncs root `.env` to `apps/web/.env.local`.

---

## Glossary and acronyms

| Term | Meaning in Pleros |
|------|-------------------|
| **AR** | Accounts Receivable — customer invoices, balance due |
| **AP** | Accounts Payable — vendor bills from purchase orders |
| **GL** | General Ledger — chart of accounts, journal entries, trial balance |
| **WMS** | Warehouse Management — pick tasks, receiving, cycle counts, waves, bins |
| **POS** | Point of Sale — admin in-store checkout at `/admin/pos` |
| **RMA** | Return Merchandise Authorization — order returns flow |
| **MSA** | Manufacturer Sales Audit — compliance reporting for regulated products |
| **B2B** | Business-to-business buyer portal (shop) |
| **POD** | Proof of Delivery — driver captures delivery confirmation |
| **COGS** | Cost of Goods Sold — GL posting on ship |
| **3-way match** | PO + receipt + vendor bill matching in AP |
| **Contract pricing** | Per-customer SKU prices in CRM |
| **Volume pricing** | Quantity tier breaks for a customer |
| **Wave picking** | Grouping pick tasks into waves with bin-sorted pick path |
| **Bin location** | Physical warehouse slot (e.g. A-01-01) for directed picking |
| **Celestial** | Pleros AI assistant (RAG + live data tools) |
| **Tenant** | Isolated company instance; all data is tenant-scoped |
| **Buyer scoping** | Portal users only see their CRM customer’s orders/invoices/quotes |
