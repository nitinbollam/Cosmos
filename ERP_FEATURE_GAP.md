# Pleros vs Established ERP Platforms — Feature Gap Analysis

Comparison of **Pleros** against well-established wholesale/distribution ERP systems (NetSuite Wholesale Distribution, Microsoft Dynamics 365 Business Central, Acumatica Distribution, Epicor Prophet 21, Infor CloudSuite, SAP Business One) as commonly evaluated in 2025–2026.

**Sources:** Industry guides for wholesale distribution ERP ([Gestisoft 2026](https://www.gestisoft.com/en/blog/erp-distribution), [NetSuite editions](https://netsuite.folio3.com/blog/netsuite-edition-for-wholesale-distributors/), [Anchor Group 2025](https://www.anchorgroup.tech/blog/wholesale-distribution-erp-systems-2025), [ERP Software Blog 2026](https://erpsoftwareblog.com/2025/11/top-11-erp-for-distribution/)).

**Pleros reference:** `PLATFORM_FEATURES.md`, `MISSING.md`, and the live codebase (Tiers 4–18).

---

## Executive summary

Pleros is **not a full enterprise ERP replacement yet**, but it **covers most core SMB wholesale/distribution workflows** that established products prioritize in “phase 1” implementations: order-to-cash, procure-to-pay, multi-warehouse inventory, B2B portal, basic WMS, AR/AP/GL, and field mobile apps.

| Segment | Coverage vs established ERPs |
|---------|------------------------------|
| **Core distribution ops** (orders, inventory, PO, basic WMS, B2B) | **~85%** — strong for a single-tenant SMB distributor |
| **Finance depth** (GL, AR/AP, recon, tax) | **~70%** — solid basics; missing multi-currency, consolidation, fixed assets |
| **Advanced supply chain** (demand planning, EDI hub, drop ship, landed cost) | **~70%** — EDI hub (850/810/856), demand planning, landed cost on PO receive |
| **Enterprise scale** (multi-entity, high volume, deep BI, HR/payroll) | **~15%** — intentionally out of scope today |

Pleros also ships **Celestial AI** — a differentiator most legacy ERPs do not include natively. It complements but does not replace gaps like general EDI or demand planning.

**Suggested positioning today:** Single-warehouse to few-warehouse **US SMB distributors** (roughly NetSuite “Starter” / Business Central profile) with modern UX + AI — not yet a Prophet 21 / Enterprise NetSuite replacement.

---

## Module-by-module comparison

### Financials & accounting

| Feature (industry standard) | Pleros | Notes |
|----------------------------|--------|-------|
| General ledger | ✅ | Chart of accounts, journal entries, trial balance |
| AR (invoicing, payments) | ✅ | Auto-invoice on ship, buyer pay, Stripe |
| AP (vendor bills) | ✅ | PO receive → vendor bill, pay bill |
| GL auto-posting | ✅ | Invoice, payment, receive, COGS, AP |
| Bank reconciliation | ✅ | Finance tab |
| 3-way match (PO / receipt / bill) | ✅ | Tier 8 / 12 |
| Sales tax | ⚠️ Partial | State jurisdiction rates; not full nexus / multi-state engine |
| Credit memos / returns GL | ✅ | RMA flow |
| Cashflow forecasting | ✅ | `@pleros/analytics-engine` (EWMA) |
| Multi-currency / FX | ❌ | Not implemented |
| Multi-subsidiary consolidation | ❌ | Single tenant org model |
| Fixed assets / depreciation | ❌ | Not implemented |
| Budgeting / FP&A | ❌ | Not implemented |
| Native PDF invoices | ⚠️ | Print-ready HTML only (`GET /invoices/:id/pdf`) |

**Verdict:** Good for **single-entity US distributor** finance. Not ready for multi-country or holding-company accounting.

---

### Inventory & warehouse (WMS)

| Feature | Pleros | Notes |
|---------|--------|-------|
| Multi-warehouse stock | ✅ | Warehouses, transfers, stock by location |
| Stock ledger / adjustments | ✅ | |
| Reorder points / low-stock alerts | ✅ | Not full demand planning |
| Cycle counts | ✅ | |
| PO receiving | ✅ | |
| Pick / pack / fulfill | ✅ | Fulfillment + order saga |
| Wave picking | ✅ | Admin + mobile |
| Bin locations / directed picking | ✅ | Bin-sorted pick path |
| Barcode labels | ✅ | Printable HTML (`GET /skus/:id/label`) |
| Lot / batch tracking | ✅ | `InventoryLot`, FEFO allocation, SKU `trackLot`, receiving + SKU detail |
| Serial number tracking | ✅ | `SerialUnit`, register/reserve/ship, SKU `trackSerial` toggle |
| RF scanner / hardware WMS | ⚠️ Partial | Mobile PWA; not industrial RF workflow |
| Directed putaway | ✅ | Bin suggestion, putaway tasks from receiving, admin confirm |
| Labor / productivity tracking | ✅ | `WmsLaborEvent` on pick/receive/putaway; 7-day metrics tab |
| Automated replenishment (MRP) | ✅ | Usage-based demand plan from stock ledger + lead time; reorder suggestions |

**Verdict:** **Mid-tier WMS** — beyond basic pick lists, but below Prophet 21 / NetSuite WMS for high-volume distribution centers.

---

### Sales & order management

| Feature | Pleros | Notes |
|---------|--------|-------|
| Order entry (admin) | ✅ | |
| B2B self-service portal | ✅ | Catalog, cart, checkout, account |
| POS / counter sales | ✅ | `/admin/pos` |
| Order lifecycle / saga | ✅ | Confirm → pick → ship |
| Contract pricing | ✅ | CRM per-customer (`CustomerPrice`) |
| Volume / tier pricing | ✅ | `VolumePriceBreak` |
| Quotes + approval + counter-offers | ✅ | |
| Credit limits | ✅ | Enforced at order confirm |
| Split shipments / tracking | ✅ | `OrderShipment`, buyer tracking UI |
| Returns (RMA) | ✅ | Credit memo, restock |
| Reorder / order templates | ✅ | |
| Backorder management | ✅ | Partial reserve, `BACKORDERED` status, `BackorderLine` queue, auto-fill on receipt |
| Drop shipping | ✅ | `DROP_SHIP` lines, auto PO per supplier, ship + invoice from admin |
| Omnichannel (Amazon / Shopify sync) | ❌ | No native connectors |
| Sales commissions | ❌ | Not implemented |

**Verdict:** Strong **B2B + counter** order model with **backorder and drop-ship**. Still missing **channel integrations** common in mid-market ERPs.

---

### Purchasing & supply chain

| Feature | Pleros | Notes |
|---------|--------|-------|
| Suppliers | ✅ | |
| Purchase orders | ✅ | |
| Receive → inventory + AP bill | ✅ | GL auto-post on receive |
| Low-stock → PO prefill | ✅ | `/admin/purchasing?skuId=` |
| Purchase requisitions / approvals | ❌ | Direct PO only |
| Landed cost (freight / duty allocation) | ✅ | Freight/duty/other on PO, allocated into unit cost on receive |
| Vendor scorecards / portal | ❌ | Not implemented |
| Demand planning / MRP | ✅ | Usage-based demand plan from stock ledger + lead times |

**Verdict:** **Procure-to-pay with landed cost and replenishment planning** is in place; requisition approvals and vendor portals are the remaining gaps.

---

### CRM & customer management

| Feature | Pleros | Notes |
|---------|--------|-------|
| Customers, leads, activities | ✅ | Admin + mobile sales |
| Import | ✅ | Spreadsheet import |
| Credit terms / limits | ✅ | |
| Contract + volume pricing | ✅ | |
| Buyer account portal | ✅ | `/account` |
| Saved payment methods | ✅ | |
| Notification preferences | ✅ | |
| Rebate / SPA / bill-back programs | ❌ | MSA compliance only, not trade rebates |
| Marketing automation | ❌ | Not implemented |

**Verdict:** Solid **B2B CRM** for distribution; no **rebate / trade promotion** depth.

---

### Delivery & field operations

| Feature | Pleros | Notes |
|---------|--------|-------|
| Delivery routes / stops | ✅ | Dispatch module |
| Driver mobile / POD | ✅ | `/m/delivery` |
| Route optimization | ⚠️ Partial | Manual stop reorder; no AI routing |
| Warehouse mobile | ✅ | Pick, receive, waves |
| Sales mobile | ✅ | Leads, activities |
| Offline sync | ⚠️ Partial | `sw.js` + queue; not full offline ERP |

**Verdict:** Better than many SMB ERPs for **lightweight field apps**; not a full transportation management system.

---

### Integrations & compliance

| Feature | Pleros | Notes |
|---------|--------|-------|
| REST API | ✅ | `/api/v1` |
| Webhooks | ✅ | Settings → Webhooks |
| Stripe payments | ✅ | Checkout + invoice pay |
| Email / SMS (SendGrid / Twilio) | ⚠️ | Works with env; console fallback |
| EDI (850 / 810 / 856 etc.) | ✅ | Trading partners, inbound 850 → orders, outbound 810/856 documents |
| MSA / regulated compliance | ✅ | Reports, S3/webhook, cron (`POST /msa/cron`) |
| Redis event bus | ⚠️ | Stub (`event-bus.ts`) |
| Public signup / multi-tenant SaaS | ✅ | `/signup` |

**Verdict:** **API-first** with a native JSON EDI layer (partners, 850 in, 810/856 out); not yet a managed X12/AS2 hub like SPS Commerce.

---

### Platform, analytics & admin

| Feature | Pleros | Notes |
|---------|--------|-------|
| Dashboard KPIs | ✅ | Admin dashboard |
| Audit log | ✅ | Settings → Audit log |
| Feature flags / plans | ✅ | STARTER / GROWTH / ENTERPRISE |
| RBAC | ⚠️ | Coarse role map (`permissions.ts`); not module-level everywhere |
| Global search | ✅ | Admin |
| AI assistant (Celestial) | ✅ | RAG + live data tools — rare in ERPs |
| Deep BI / custom reports | ⚠️ | KPIs + cashflow; no report builder |
| HR / payroll | ❌ | Not implemented |
| Manufacturing / BOM | ❌ | Not implemented |

---

## What Pleros has that many ERPs lack (or charge extra for)

1. **Celestial AI** — in-app copilot with live orders, warehouses, invoices + documentation RAG
2. **Modern single-port SPA** — React 19, SSE streaming, mobile PWAs on one origin
3. **Unified B2B portal** — catalog through invoices and quotes in one buyer UX
4. **POS + B2B + admin** in one monorepo
5. **Fast local dev** — SQLite seed, demo tenant, single port `:4000`
6. **Themeable enterprise UI** — Obsidian (matte black) and Aurora (light) themes with an in-app switcher, persisted per user

---

## Priority gap list (roadmap toward ERP parity)

### High priority — wholesale distributors

| # | Gap | Why it matters |
|---|-----|----------------|
| 1 | ~~**General EDI**~~ | ✅ JSON interchange — partners, 850 ingest, 810/856 export |
| 2 | ~~**Backorder management**~~ | ✅ Shipped — partial allocate, queue, auto-fill on receipt |
| 3 | ~~**Demand planning**~~ | ✅ Usage forecast from ledger + lead time on stock levels |
| 4 | ~~**Drop shipping**~~ | ✅ Shipped — DROP_SHIP lines, vendor PO, admin ship |
| 5 | ~~**Production database path**~~ | ✅ `PLEROS_DB_PROVIDER=postgres`, migrate-all, `db:setup:postgres`, health check |

### Medium priority — mid-market

| # | Gap |
|---|-----|
| 6 | ~~Landed cost on PO receive~~ | ✅ Freight/duty/other allocated into inventory unit cost on receive |
| 7 | Purchase requisition + approval workflow |
| 8 | Lot / serial recall & compliance UI (beyond basic tracking) |
| 9 | Deeper sales tax (nexus, exemptions) |
| 10 | Native PDF documents |
| 11 | Fine-grained RBAC per module |
| 12 | Report builder / export suite |

### Enterprise — usually phase 2+

| # | Gap |
|---|-----|
| 13 | Multi-currency / multi-subsidiary |
| 14 | Rebate & vendor allowance programs |
| 15 | Fixed assets |
| 16 | Manufacturing / kitting / BOM |
| 17 | HR & payroll |
| 18 | Advanced BI / AI forecasting (beyond cashflow EWMA) |
| 19 | ~~Labor management in WMS~~ | ✅ Basic productivity metrics |

**Suggested implementation order:** ~~EDI → demand planning → Postgres hardening → landed cost~~ (shipped). Next: purchase requisitions, deeper tax, report builder.

---

## Industry “core modules” checklist (distribution ERP standard)

Reference: what NetSuite, Business Central, and mid-market distributors typically implement first.

| Core module (industry) | Pleros status |
|------------------------|---------------|
| Financials (GL, AR, AP) | ✅ In place |
| Inventory (multi-location) | ✅ In place |
| Order management | ✅ In place |
| Procurement (PO, receive) | ✅ In place |
| WMS (pick / pack / ship) | ✅ In place (mid-tier depth) |
| B2B customer portal | ✅ In place |
| CRM + contract pricing | ✅ In place |
| Warehouse mobile / barcode | ⚠️ Partial |
| EDI / trading partner hub | ✅ JSON 850/810/856 + partner config |
| Demand planning / MRP | ✅ Usage-based replenishment |
| Multi-entity / FX | ❌ Missing |

---

## Bottom line

| Question | Answer |
|----------|--------|
| **Do we have everything established ERPs offer?** | **No** — enterprise finance, advanced supply chain, EDI hub, rebates, and deep BI are gaps. |
| **Do we have core SMB wholesale workflows?** | **Yes, largely** — order-to-cash, procure-to-pay, inventory, WMS basics, B2B, AR/AP/GL, dispatch, CRM pricing, MSA, POS, and Celestial are wired together. |
| **Who is Pleros best for today?** | US SMB distributors with 1–few warehouses, B2B-heavy sales, and a need for modern UX + AI — not yet high-volume multi-entity international operations. |

---

## Related documentation

| Document | Purpose |
|----------|---------|
| `PLATFORM_FEATURES.md` | Full Pleros feature reference and tier changelog |
| `MISSING.md` | Short backlog of known deferred items |
| `docs/celestial/` | LLM knowledge base for Celestial AI |

---

*Last updated: June 2026 — based on Pleros Tiers 4–18 and wholesale ERP industry benchmarks.*
