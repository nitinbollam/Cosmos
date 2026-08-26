# Admin Module Guides (LLM Knowledge Base)

Comprehensive reference and how-to guides for all Pleros ERP admin modules. Indexed by Celestial to answer questions about platform features, data locations, workflows, and permissions.

**Keywords:** admin, ERP, module guide, how to, dashboard, inventory, orders, warehouse, fulfillment, wave picking, purchasing, landed cost, finance, GL, dispatch, POS, CRM, compliance, settings

---

## 1. Dashboard — Operational Overview
- **Route:** `/admin`
- **Purpose:** Executive and operational headquarters showing high-level KPIs, 14-day cashflow forecasts, active low-stock alerts, recent sales orders, and tenant health status.
- **Key Cards:**
  - Revenue Today & Month-to-Date
  - Open Orders & Fulfillment Status
  - Low Stock Alerts (direct links to reorder)
  - Cash Flow Forecast Chart
  - Recent Order Activity feed

---

## 2. Inventory & Multi-Warehouse Stock
- **Route:** `/admin/inventory` (SKU detail at `/admin/inventory/:skuId`)
- **Key Capabilities:**
  - Multi-Warehouse Stock Matrix: View on-hand, reserved, and available quantities by warehouse.
  - Stock Adjustments: Record cycle count variances, damage, or audit corrections with reason codes.
  - Inter-Warehouse Transfers: Initiate and track transfers between warehouses.
  - Demand Replenishment (EWMA): Calculate suggested reorder quantities using 70-day Exponentially Weighted Moving Average demand and supplier lead times.
  - Bulk Spreadsheet Import: Import SKUs, barcodes, categories, and opening balances via CSV/Excel.
  - Barcode & QR Label Printing: Generate thermal printable labels (`4x2`, `4x1`, `3x2`, `2x1`) with Code 128 and QR codes.

---

## 3. Orders & Order-to-Cash Pipeline
- **Route:** `/admin/orders` (Order detail at `/admin/orders/:id`)
- **Key Capabilities:**
  - Order Management: View orders filtered by status (`PENDING`, `CONFIRMED`, `PROCESSING`, `PACKED`, `SHIPPED`, `DELIVERED`, `CANCELLED`) and channel (`B2B_PORTAL`, `POS`, `SALES_REP`, `API`).
  - Order Saga Timeline: Visual audit trail of credit check, inventory allocation, pick wave assignment, and shipment.
  - Confirm / Cancel: Approve pending orders or cancel with inventory compensation.
  - Returns & RMAs: Create RMA return authorizations, restock returned units, and auto-issue credit memos.
  - Split Shipments: Dispatch partial quantities across multiple tracking numbers and warehouses.

---

## 4. Fulfillment & Pick/Pack Tasks
- **Route:** `/admin/fulfillment`
- **Key Capabilities:**
  - Task Queue: View active fulfillment pick tasks grouped by order and priority.
  - Picker Assignment: Assign floor staff to specific pick lines or batch tasks.
  - Fast Actions: `Pick All`, `Mark Short` (if bin quantity is missing), `Pack Carton`, and `Dispatch Carrier`.
  - Syncs in real time with the Warehouse PWA (`/m/warehouse`).

---

## 5. Warehouse Operations & WMS
- **Route:** `/admin/warehouse`
- **Key Tabs:**
  - **Pick Tasks**: Live queue of pick lines with bin location codes (`A-01-01`).
  - **Wave Picking**: Group multiple orders into consolidated picking waves with optimized bin travel paths.
  - **Bin Locations**: Define aisle, rack, shelf, and bin mapping for directed putaway and picking.
  - **Receiving Sessions**: Dock receiving scanner with live camera barcode/QR scanner (`/m/warehouse/receiving`).
  - **Putaway Tasks**: Direct received goods to designated storage bins.
  - **Cycle Counts**: Blind count sessions, variance calculation, and automatic GL inventory adjustments.

---

## 6. Purchasing & Procure-to-Pay
- **Route:** `/admin/purchasing` (PO detail at `/admin/purchasing/:id`)
- **Key Capabilities:**
  - Supplier Management: Maintain vendor records, lead times, payment terms, and contacts.
  - Purchase Orders: Create, approve, and track purchase orders.
  - Dock Receiving: Receive purchase order lines directly into warehouse inventory.
  - Landed Cost Allocation: Distribute inbound freight, customs, and duty charges across received units to compute true landed COGS.
  - 3-Way Match: Automatically verify PO unit prices, received quantities, and vendor AP bills before approving payment.

---

## 7. Compliance & Regulatory Controls
- **Route:** `/admin/compliance`
- **Key Capabilities:**
  - MSA Reports: Master Settlement Agreement and tobacco/regulated product compliance reporting.
  - Age Verification Policies: Enforce mandatory minimum age attestations on POS and B2B channels.
  - Regulated License Validation: Verify wholesale customer reseller and distributor licenses.
  - Batch & Lot Recall: Instant traceability across received supplier lots, warehouse storage, and customer shipments.

---

## 8. CRM & Customer Pricing
- **Route:** `/admin/crm`
- **Key Capabilities:**
  - Customer Accounts: Manage B2B accounts, credit limits, payment terms (Net 15/30/60), and contacts.
  - Contract Price Books: Set per-customer custom pricing and tiered volume discounts on specific SKUs.
  - Lead Pipeline: Track sales prospects from outreach to customer conversion.
  - Activity Log: Record sales visits, calls, and email correspondence.

---

## 9. Quotes & Price Negotiations
- **Route:** `/admin/quotes` (Quote detail at `/admin/quotes/:id`)
- **Key Capabilities:**
  - Buyer Quote Ingestion: Review price requests and counter-offers submitted from the B2B Storefront.
  - Margin & Cost Analysis: View SKU unit cost and calculated profit margins during price negotiations.
  - Approval & Conversion: Approve quotes to lock in prices and convert into confirmed sales orders.

---

## 10. Fleet Dispatch & Route Logistics
- **Route:** `/admin/dispatch`
- **Key Capabilities:**
  - Delivery Manifests: Assign shipped orders to fleet vehicles and delivery drivers.
  - Route Stop Optimization: Nearest-neighbor sequencing using customer GPS coordinates and Haversine distance calculations.
  - Live Tracking: Real-time driver status, stop completions, and failed delivery exception notes.
  - Digital Proof of Delivery (POD): View driver photo uploads and recipient signatures.

---

## 11. Finance & General Ledger
- **Route:** `/admin/finance`
- **Key Capabilities:**
  - Accounts Receivable (AR): Invoices, payments received, credit memos, and 0–90+ day aging buckets.
  - Accounts Payable (AP): Vendor bills, 3-way matching, and scheduled bill payments.
  - Double-Entry General Ledger: Real-time automated journal postings for revenue, COGS, inventory asset, and cash.
  - Bank Reconciliation: Reconcile bank statements against recorded receipts and disbursements.
  - Trial Balance & Financial Reports: Generate Trial Balance, Balance Sheet, and P&L statements with monthly/quarterly filters.

---

## 12. Point of Sale (POS)
- **Route:** `/admin/pos`
- **Key Capabilities:**
  - Counter Checkout: Fast register interface for walk-in wholesale customers.
  - Rapid Barcode Lookup: Scan or search SKUs with live price and stock verification.
  - Compliance Attestation: Embedded prompt for age verification when cart contains restricted items.
  - Flexible Tenders: Process cash, card (Stripe terminal), or charge to customer Net Terms accounts.
  - Receipt Printing: Digital and thermal printable transaction receipts.

---

## 13. Settings & Platform Administration
- **Route:** `/admin/settings`
- **Key Capabilities:**
  - Company Profile: Tenant details, currency, default warehouse, and tax policy settings.
  - Team & RBAC: Manage staff users and granular module permissions.
  - Warehouses: Add, configure, and manage physical storage sites.
  - Stripe Connect: Configure payouts and merchant payment processing.
  - Webhooks & API Keys: Configure outbound webhooks and secure developer API tokens.
  - Audit Log: Immutable security log of all tenant actions, logins, and data modifications.
