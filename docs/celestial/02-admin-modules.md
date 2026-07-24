# Admin Module Guides (LLM Knowledge Base)

Detailed how-to guides for each Pleros admin module. Use these to answer "how does X work" and "where do I find Y" questions.

**Keywords:** admin, ERP, module guide, how to, dashboard, inventory, orders, warehouse, finance, settings

---

## Dashboard — how it works

**Route:** `/admin`

The admin dashboard shows operational KPIs for the tenant: revenue and order metrics, a cashflow forecast chart, low-stock alerts, recent orders, and compliance badge status.

**Data sources:** `GET /api/v1/analytics/kpis`, KPI snapshots, inventory alerts.

**When to use:** Start of day overview; click through to Inventory (low stock), Orders, or Finance from alerts and widgets.

---

## Inventory — how it works

**Route:** `/admin/inventory`, SKU detail at `/admin/inventory/:skuId`

**Keywords:** inventory, SKU, stock, catalog, reorder point, adjustment, transfer, barcode label

Inventory manages the product catalog (SKUs) and stock levels per warehouse.

**Key capabilities:**
- View/search SKUs with stock by warehouse
- Adjust stock (corrections, damage, etc.)
- Transfer stock between warehouses
- Spreadsheet import for bulk SKU updates
- Low-stock alerts when quantity falls below reorder point
- Print barcode labels (`GET /skus/:id/label?qty=&size=&symbols=` — printable HTML with Code128 + QR; sizes `4x2`|`4x1`|`3x2`|`2x1`)

**Stock model:** Each SKU has `StockLevel` rows per warehouse, optional `binCode` on location, and a `StockLedgerEntry` audit trail.

**Related:** Purchasing creates POs to replenish; Fulfillment allocates stock on order confirm; WMS pick tasks decrement on pick.

---

## Orders — how it works

**Route:** `/admin/orders`, detail at `/admin/orders/:id`

**Keywords:** orders, sales order, confirm, cancel, fulfill, return, RMA, shipment, tracking, split shipment

**Admin order workflow:**
1. Order appears as **PENDING** (from B2B checkout, POS, or manual creation)
2. **Confirm** — validates credit, allocates inventory, starts fulfillment
3. Warehouse **picks and packs** via Fulfillment/WMS
4. **Ship** — creates shipments with carrier + tracking; may auto-issue **invoice**
5. **Deliver** — dispatch/mobile marks delivered
6. **Return (RMA)** — Process return modal: restock, credit memo, line `returnedQty`

**Order detail shows:** line items, saga timeline, payments, invoice link, shipments (carrier, tracking, split qty), return actions.

**API:** `orders.ts`, `order-orchestration.ts`, `order-saga.ts`. Returns: `POST /orders/:id/returns`.

---

## Fulfillment — how it works

**Route:** `/admin/fulfillment`

**Keywords:** fulfillment, pick, pack, dispatch, picker, pick task, pack task

Fulfillment is the operational queue for warehouse staff to execute pick and pack tasks generated from confirmed orders.

**Actions:** Assign picker, pick-all, mark packed, dispatch to carrier.

**Links to WMS:** Pick lines include SKU, qty, warehouse, and **bin code** for directed picking.

**Mobile:** Warehouse PWA (`/m/warehouse`) shows the same tasks for floor workers.

---

## Warehouse (WMS) — how it works

**Route:** `/admin/warehouse`

**Keywords:** warehouse, WMS, receiving, cycle count, wave picking, bin location, pick path

The Warehouse module covers inbound and accuracy operations beyond order fulfillment.

**Tabs/capabilities:**
- **Pick tasks** — open WMS pick lines
- **Receiving sessions** — receive PO goods into stock
- **Cycle counts** — count bins/SKUs, post adjustments
- **Wave picking** — create/start/complete waves from pending tasks; optimized **pick path** sorted by bin code
- **Bin locations** — define bins per warehouse (e.g. A-01-01); used on pick lines and mobile

**API modules:** `wms-*.ts`, `wave-picking.ts`, `pick-bin-resolver.ts`.

**Mobile waves:** `/m/warehouse` → Waves tab → wave detail with start/complete.

---

## Warehouses (locations) — how it works

**Route:** `/admin/settings` → Warehouses tab

**Keywords:** warehouse, warehouses, distribution center, DC, location, MAIN, EAST, default warehouse

Warehouses are physical stocking locations. Each tenant can have multiple warehouses with code, name, address, and a default flag.

**Demo seed warehouses:**
- **MAIN** — Main Warehouse, Dallas TX (default)
- **EAST** — East Coast DC, Newark NJ

Stock levels, transfers, and pick tasks are warehouse-scoped. Celestial can list live warehouses via the `list_warehouses` tool.

---

## Purchasing — how it works

**Route:** `/admin/purchasing`

**Keywords:** purchasing, PO, purchase order, supplier, receive, vendor, AP bill

**Workflow:**
1. Create PO for a supplier with line items (SKUs + qty)
2. **Receive goods** — increments inventory, creates/updates **vendor bill (AP)**
3. GL auto-posts: Dr Inventory / Cr AP on receive
4. Pay bill in Finance → AP tab

**Low-stock prefill:** `/admin/purchasing?skuId=` opens PO drawer with reorder qty from alerts.

---

## CRM — how it works

**Route:** `/admin/crm`, customer detail at `/admin/crm/customers/:id`

**Keywords:** CRM, customer, lead, activity, contract pricing, volume pricing, credit limit

**Capabilities:**
- Customer records linked to B2B portal users by email
- Leads and sales activities (also on mobile sales app)
- **Contract pricing** — per-SKU custom prices for a buyer (`CustomerPrice`)
- **Volume pricing** — quantity tier breaks (`VolumePriceBreak`)
- Lead conversion to customer
- Import customers/leads from spreadsheet

**Buyer scoping:** Portal orders/invoices/quotes filter by the buyer's `customerId`.

---

## Quotes — how it works

**Routes:** Admin `/admin/quotes`, Buyer `/quotes`, `/quotes/new`, `/quotes/:id`

**Keywords:** quote, B2B quote, counter-offer, approval, submit to order

**Quote statuses:** OPEN → PENDING_APPROVAL → APPROVED → SUBMITTED (converted to order).

**Buyer:** Creates quote from catalog lines; can receive **counter-offers** from admin.

**Admin:** Approves/rejects; counter-offer modal on quote detail.

---

## Dispatch — how it works

**Route:** `/admin/dispatch`

**Keywords:** dispatch, delivery, route, driver, stop, POD, proof of delivery, ETA

**Capabilities:**
- Build delivery routes with ordered stops
- Assign driver; view map
- Driver mobile app marks failed or completes **POD**
- Buyer order detail shows delivery route ETA and tracking

**API:** `dispatch.ts`. Notifications on ship/delivery when SendGrid/Twilio configured.

---

## Compliance — how it works

**Route:** `/admin/compliance`

**Keywords:** compliance, MSA, manufacturer sales audit, tax, batch, regulated

**MSA (Manufacturer Sales Audit):**
- Generate reports from sales data
- Store files locally (`.data/msa/`) or upload via S3/webhook env
- EDI submit to manufacturer endpoint
- Cron automation: `POST /msa/cron`

**Tax:** State jurisdiction rates in `compliance-tax.ts`; applied at order checkout.

---

## Finance — how it works

**Route:** `/admin/finance`

**Keywords:** finance, AR, AP, invoice, bill, payment, trial balance, GL, bank reconciliation, cashflow

**Tabs:**
- **AR (Accounts Receivable)** — customer invoices, balance, overdue, record payment
- **AP (Accounts Payable)** — vendor bills from PO receive, 3-way match status, pay bill
- **Trial balance** — GL accounts from ledger
- **Cashflow chart** — forecast via analytics engine
- **Bank reconciliation** — bank accounts, statement lines, reconcile

**GL auto-posting (`operations-gl.ts`, `invoice-gl.ts`):**
- Invoice issue: Dr AR / Cr Revenue
- Payment received: Dr Cash / Cr AR
- PO receive: Dr Inventory / Cr AP
- AP payment: Dr AP / Cr Cash
- Ship COGS: Dr COGS / Cr Inventory

**Invoices:** Auto-issued on ship; PDF via `GET /invoices/:id/pdf` (native PDF).

---

## POS (Point of Sale) — how it works

**Route:** `/admin/pos`

**Keywords:** POS, point of sale, register, checkout, walk-in, cash, card, check, receipt

POS is an **admin in-store checkout** for walk-in or counter sales (not the B2B buyer portal).

**How to use POS in Pleros:**
1. Go to **Admin → POS** (`/admin/pos`)
2. Select a **register** (seed includes a default register)
3. Select or create a **customer** (seed includes walk-in customer)
4. Add **SKUs** to cart by search/code
5. Choose payment: **cash**, **card**, or **check**
6. Complete checkout — creates an order + payment
7. **Print receipt** — `GET /pos/orders/:id/receipt` (HTML receipt)

**API:** `POST /api/v1/pos/orders`, `pos.ts`, `pos-receipt.ts`.

**Difference from B2B shop:** POS is staff-operated at admin; B2B shop is buyer self-service at `/catalog` → `/checkout`.

---

## Settings — how it works

**Route:** `/admin/settings`

**Keywords:** settings, company, team, invite, warehouse, webhook, Stripe, MSA, feature flags, audit log, integrations

**Tabs:**
- Company profile and onboarding
- Team invites and user management
- **Warehouses** — add/edit warehouse locations
- Webhooks — subscription CRUD and test
- Stripe / MSA / billing plan configuration
- **Feature flags** — plan defaults + tenant overrides (`celestial`, etc.)
- **Audit log** — filterable event viewer
- **Integrations** — SendGrid/Twilio/webhook notification provider status

---

## Notifications (admin)

**Route:** `/admin/notifications`

**Keywords:** notifications, SendGrid, Twilio, email, SMS, alert

Inbox for notification requests. Providers: SendGrid (email), Twilio (SMS) when env vars set; console/webhook fallback otherwise.

**Triggers:** order created/shipped, invoice issued, payment received, low stock.

---

## Celestial AI (admin)

**Route:** `/admin/celestial` (full page) + floating ✦ panel on all admin pages

**Keywords:** Celestial, AI, assistant, chat, copilot

See `05-celestial-ai.md` for full Celestial documentation.
