# Buyer Portal and Mobile Apps (LLM Knowledge Base)

Guides for the B2B storefront, buyer account features, and mobile field apps.

**Keywords:** buyer, B2B, shop, storefront, catalog, cart, checkout, mobile, PWA, warehouse app, delivery app, sales app

---

## B2B shop overview

**Keywords:** B2B portal, buyer portal, shop, self-service ordering

The B2B shop is the buyer-facing storefront. Logged-in buyers browse catalog, add to cart, checkout, view orders/invoices/quotes, and manage their account.

**Login:** `/login` — buyer roles `STAFF`, `VIEWER` tied to a CRM customer record.

**Demo buyer:** `buyer@acme-retail.com` / `buyer1234` (Acme Retail customer).

**Scoping:** All orders, invoices, and quotes are filtered to the buyer's `customerId` via `buyer-context.ts`.

---

## Catalog — how it works

**Route:** `/catalog`

**Keywords:** catalog, products, search, filter, contract price, add to cart

- Search and filter SKUs
- Shows **contract pricing** for logged-in buyers (from CRM `CustomerPrice`)
- **Volume pricing** tier breaks applied at checkout
- Add items to cart (Zustand store: `cart.store.ts`)

**Celestial tool:** `search_catalog` returns in-stock SKUs with prices for the buyer.

---

## Cart and checkout — how it works

**Routes:** `/cart`, `/checkout`

**Keywords:** cart, checkout, shipping, payment, NET_TERMS, Stripe, saved card

**Checkout steps:**
1. Review cart lines with contract/list prices (validated server-side)
2. Shipping address and method
3. Payment — **NET_TERMS**, **CARD** (Stripe authorize/capture), or saved payment methods
4. Place order → status **PENDING** until admin confirms

**Saved cards:** Checkout can pick saved card or save new card to account (Tier 10).

**Tax:** Computed from state jurisdiction rates at checkout.

---

## Buyer orders — how it works

**Routes:** `/orders`, `/orders/:id`

**Keywords:** my orders, order history, reorder, tracking, shipment

- List order history with status and totals
- Order detail: line items, payments, invoice chip, **tracking timeline**
- **Shipments** with carrier links and split packages
- **Delivery route ETA** when dispatch assigned
- **Reorder** button — batch add prior lines to cart (`GET /orders/:id/reorder-lines` with current contract prices)

**Celestial tools:** `get_my_orders`, `get_order_detail` (buyer-scoped).

---

## Buyer invoices — how it works

**Routes:** `/invoices`, `/invoices/:id`

**Keywords:** invoice, balance due, pay invoice, overdue, PDF

- List AR invoices with status, total, balance
- Pay balance: record payment or **Stripe card pay** (`POST /invoices/:id/pay/stripe`)
- Download **invoice PDF** (`GET /invoices/:id/pdf` — print-ready HTML)

**Celestial tool:** `list_my_invoices` (buyer-scoped).

---

## Buyer quotes — how it works

**Routes:** `/quotes`, `/quotes/new`, `/quotes/:id`

**Keywords:** quote, request quote, counter-offer, submit quote

- Create quote from catalog lines
- Track status through approval workflow
- Accept admin **counter-offers**
- Submit approved quote to order

**Celestial tool:** `list_my_quotes`.

---

## Buyer account — how it works

**Route:** `/account`

**Keywords:** account, credit limit, payment terms, address, notification preferences, order templates, saved cards

**Account page features:**
- Credit limit and payment terms display
- Shipping/billing address edit (`PATCH /customers/me`)
- **Order templates** — save cart as template, reorder with contract prices
- **Saved payment methods** — list/add/remove/default cards
- **Notification preferences** — email/SMS toggles for order/invoice alerts

---

## Buyer notifications inbox

**Route:** `/notifications`

**Keywords:** notifications, inbox, order alert, invoice alert

Shop notification inbox filtered by signed-in buyer email. Shows order shipped, invoice issued, payment received messages (seed includes demo rows).

---

## Mobile warehouse app — how it works

**Route:** `/m/warehouse`

**Keywords:** mobile warehouse, pick, receiving, wave, bin, PWA

**Login:** `warehouse@cosmos.local` / `warehouse1234`

**Features:**
- Pick task list with **bin-directed** pick lines (`binCode` from stock levels)
- Receiving sessions for inbound PO goods
- **Wave picking** tab — start/complete waves, bin-sorted pick path
- Offline queue (`offline-queue.ts`, service worker `sw.js`) with sync banner

**Install:** PWA manifest; start URL `/m/warehouse`.

---

## Mobile delivery app — how it works

**Route:** `/m/delivery`

**Keywords:** mobile delivery, driver, route, stop, POD, proof of delivery

**Login:** `driver@cosmos.local` / `driver1234`

**Features:**
- View assigned delivery routes and stops
- Reorder stops, mark failed, capture **proof of delivery (POD)**
- Links to admin dispatch module

---

## Mobile sales app — how it works

**Route:** `/m/sales`

**Keywords:** mobile sales, leads, CRM activities, field sales

**Login:** `sales@cosmos.local` / `sales1234`

**Features:**
- View/manage leads and customers
- Log sales activities in the field
- Syncs with admin CRM module

---

## Hub and navigation

**Route:** `/` — links to Admin console, B2B Shop, and Mobile apps.

**Shop header** (`shop-header.tsx`): Catalog, Orders, Invoices, Quotes, cart badge, sign-in/out. Mobile hamburger nav on small screens.
