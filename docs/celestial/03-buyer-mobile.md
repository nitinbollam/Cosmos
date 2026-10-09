# B2B Storefront & Mobile Field Apps Guide (LLM Knowledge Base)

Comprehensive reference for the buyer-facing B2B portal and mobile Progressive Web Apps (PWAs).

**Keywords:** B2B portal, shop, catalog, cart, checkout, orders, invoices, quotes, mobile app, PWA, warehouse app, delivery app, sales app, proof of delivery, barcode scanning

---

## 1. B2B Buyer Storefront

The B2B Storefront gives wholesale customers a 24/7 self-service buying and account portal.

### Key Pages & Capabilities:
- **Product Catalog (`/catalog`)**:
  - Stock-Aware Catalog: Displays live on-hand quantities for the selected fulfillment warehouse.
  - Category Gradients & Visual Cards: High-resolution visual tags for beverages, vapes, snacks, accessories, and displays.
  - Contract Pricing: Logged-in buyers automatically see their negotiated contract tier with list price comparisons.
  - Quantity Steppers: Interactive `[-] [ X ] [+]` steppers for fast wholesale carton and case orders.
- **Wholesale Cart (`/cart`)**:
  - Review line items, SKU codes, unit costs, and source warehouse locations.
  - Steppers and 1-click line removal.
  - Sticky order summary with subtotal, tax note, and freight estimate.
- **Checkout & Net Terms (`/checkout`)**:
  - Payment Options: Charge to Net Terms credit balance (Net 15/30/60) or pay instantly via credit card (Stripe).
  - Credit Limit Verification: Prevents order placement if exposure exceeds tenant-approved credit limit.
  - Shipping Address: Select saved company delivery addresses or enter new ship-to destinations.
- **Buyer Orders (`/orders`, `/orders/:id`)**:
  - View historical and active orders with real-time fulfillment status (`PENDING` → `PROCESSING` → `SHIPPED` → `DELIVERED`).
  - 1-Click Reorder: Re-add all lines from a previous order at current contract prices.
- **Invoices & Statements (`/invoices`, `/invoices/:id`)**:
  - View issued invoices, payment due dates, and remaining balances.
  - Download official PDF invoice documents.
  - Make partial or full invoice payments online.
- **Quotes & Price Requests (`/quotes`, `/quotes/new`)**:
  - Build custom quotes for bulk volume pricing and submit for distributor approval.
  - Track quote approval status and convert approved quotes into orders.
- **Buyer Notifications (`/notifications`)**:
  - View order status updates, invoice issuances, and shipment tracking notifications scoped strictly to the buyer's account.

---

## 2. Mobile Warehouse PWA (`/m/warehouse`)

Designed for warehouse floor staff using phones, tablets, or rugged barcode scanner terminals.

### Core Tabs:
- **Pick Tasks**:
  - Live queue of assigned picking tasks sorted by order priority and warehouse zone.
  - Directed picking instructions displaying target bin location (`A-02-04`), SKU code, name, and quantity.
  - `Pick All` or line-by-line barcode confirmation.
- **Wave Picking**:
  - Consolidated multi-order picking waves with single-pass bin travel routes to minimize walking time.
- **Bin Locations**:
  - Interactive lookup of bin inventory balances and location tags.
- **Mobile Receiving Scanner (`/m/warehouse/receiving`)**:
  - Built-in camera and hardware barcode scanner supporting Code 128, QR codes, UPC-A, and EAN-13.
  - 1-Tap scanning modal with instant SVG QR code pairing.
- **Directed Putaway**:
  - Guides received goods from dock staging areas to designated storage rack bins.
- **Cycle Counts**:
  - On-floor count entry and instant variance calculation.

---

## 3. Mobile Delivery PWA (`/m/delivery`)

Equips delivery drivers with an all-in-one route management and proof-of-delivery (POD) tool.

### Core Capabilities:
- **Daily Route Manifest**:
  - View assigned orders sequenced by nearest-neighbor optimization.
  - Order numbers, customer company names, delivery addresses, and package item counts.
- **Turn Navigation & Map Links**:
  - 1-Tap shortcut to launch native GPS navigation (Apple Maps / Google Maps).
- **Proof of Delivery (POD) Capture**:
  - Capture digital photo evidence of delivered cartons at customer receiving doors.
  - Recipient signature capture and delivery notes.
  - Instant status update: transitions order status to `DELIVERED` and notifies the buyer.
- **Exception Logging**:
  - Record failed delivery attempts (e.g. store closed, refused shipment) with reason notes.

---

## 4. Mobile Sales PWA (`/m/sales`)

Enables outside sales representatives to manage accounts and close deals in the field.

### Core Capabilities:
- **Customer Lookup**:
  - Instant search of customer accounts, contact details, payment terms, and open balances.
- **Lead Pipeline**:
  - Create new leads, update pipeline stages, and convert leads into active B2B customers.
- **Visit Activity Logging**:
  - Log field visits, phone calls, and meeting notes attached directly to the CRM customer timeline.
- **Field Quote Generation**:
  - Build and submit custom price quotes on-site with wholesale buyers.
