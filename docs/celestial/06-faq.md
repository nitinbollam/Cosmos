# Common Questions FAQ (LLM Knowledge Base)

Frequently asked questions with direct answers. Celestial should use these for quick, accurate responses.

**Keywords:** FAQ, common questions, help, how do I, what is, where is, troubleshooting

---

## What is Cosmos?

Cosmos is a wholesale ERP and distribution platform for SMB distributors. It includes inventory, orders, warehouse operations, purchasing, CRM, dispatch, finance (AR/AP/GL), a B2B buyer portal, mobile apps, and the Celestial AI assistant. Everything runs on http://localhost:4000 in local dev.

---

## How do I log in?

| Role | URL | Email | Password |
|------|-----|-------|----------|
| Admin | `/admin/login` | `admin@cosmos.local` | `admin1234` |
| Buyer | `/login` | `buyer@acme-retail.com` | `buyer1234` |
| Warehouse mobile | `/m/login` | `warehouse@cosmos.local` | `warehouse1234` |
| Driver mobile | `/m/login` | `driver@cosmos.local` | `driver1234` |
| Sales mobile | `/m/login` | `sales@cosmos.local` | `sales1234` |

Run `npm run seed` first if accounts don't exist.

---

## How does POS work in Cosmos?

POS (Point of Sale) is **admin in-store checkout** at `/admin/pos` — not the B2B buyer shop.

**Steps:**
1. Open Admin → POS
2. Select register and customer (walk-in customer exists in seed)
3. Search/add SKUs to cart
4. Pay with cash, card, or check
5. Print receipt after checkout

POS creates a real order and payment in the system. B2B buyers use `/catalog` → `/checkout` instead.

---

## How does order fulfillment work?

1. Buyer or POS creates order (**PENDING**)
2. Admin **confirms** order → inventory allocated, pick tasks created
3. Warehouse **picks** items (Fulfillment or `/m/warehouse`) using bin-directed pick lines
4. Staff **packs** and **ships** — shipments with carrier tracking created
5. **Invoice auto-issued** on ship; GL posts AR
6. Driver **delivers** via dispatch/mobile; buyer sees tracking on order detail

---

## What warehouses exist in the demo?

After seeding, demo warehouses include:
- **MAIN** — Main Warehouse (Dallas, TX) — default
- **EAST** — East Coast DC — Newark, NJ

View in Settings → Warehouses or ask Celestial "What warehouses do we have?"

---

## How do returns (RMA) work?

On admin order detail (`/admin/orders/:id`), use **Process return** modal:
- Select lines and return quantities
- System restocks inventory, creates credit memo, updates line `returnedQty`
- Order may move to **RETURNED** status
- GL credit memo posts if configured

---

## How does invoicing work?

- Invoices are **auto-created when an order ships**
- Appear in Finance → AR tab (admin) and `/invoices` (buyer)
- Buyers can pay balance via record payment or Stripe card
- PDF download: print-ready HTML at `/invoices/:id/pdf`
- GL: Dr AR / Cr Revenue on issue; Dr Cash / Cr AR on payment

---

## How does contract pricing work?

Admin sets custom SKU prices per customer in CRM customer detail. Logged-in buyers see contract prices in catalog and checkout. Server validates prices on checkout — buyers cannot override prices client-side.

---

## How does wave picking work?

1. Admin → Warehouse → Wave picking tab
2. Create wave from pending pick tasks
3. Start wave — system computes **pick path** sorted by bin location
4. Pickers follow bin order on admin or mobile `/m/warehouse`
5. Complete wave when all tasks done

---

## How do I check low stock?

- Admin dashboard shows low-stock alerts
- Inventory module lists SKUs below reorder point
- Ask Celestial: "What's low on stock?" (uses `list_low_stock` tool)
- Create PO from alert: `/admin/purchasing?skuId=` pre-fills reorder qty

---

## How do quotes work for buyers?

1. Buyer creates quote at `/quotes/new` from catalog
2. Quote goes through approval: OPEN → PENDING_APPROVAL → APPROVED
3. Admin may send counter-offers; buyer accepts on quote detail
4. Submit approved quote → converts to order

---

## How do I enable Celestial AI?

1. Log in as admin
2. Settings → Features → enable **celestial** flag
3. Set `OPENROUTER_API_KEY` in `.env` for full LLM answers (optional — mock mode works with tools)
4. Open `/admin/celestial` or click ✦ floating button

---

## Why does Celestial show mock mode?

Mock mode appears when no LLM API key is configured. Celestial still answers **data questions** via live tools and structured tables. For natural-language how-to answers, set `OPENROUTER_API_KEY` and `CELESTIAL_PROVIDER=openrouter` in `.env`, then restart dev server.

---

## How do I run Cosmos locally?

```bash
npm install
cp .env.example .env
npm run db:setup && npm run db:generate && npm run db:migrate && npm run seed
npm run dev
```

Open http://localhost:4000. UI and API share port 4000.

---

## What's the difference between Fulfillment and Warehouse?

- **Fulfillment** (`/admin/fulfillment`) — operational queue for order pick/pack/dispatch tasks
- **Warehouse** (`/admin/warehouse`) — broader WMS: receiving, cycle counts, wave picking, bin locations

Both work with the same underlying WMS pick tasks; Warehouse adds inbound and accuracy workflows.

---

## What's the difference between AR and AP?

- **AR (Accounts Receivable)** — money customers owe you (sales invoices)
- **AP (Accounts Payable)** — money you owe suppliers (vendor bills from PO receive)

Both are in Finance module with separate tabs. GL auto-posts journal entries for issue, receive, and payment events.

---

## How do mobile apps work offline?

Mobile PWA uses a service worker (`sw.js`) and localStorage action queue. Actions taken offline replay when connectivity returns (Background Sync). `OfflineBanner` shows sync status on mobile pages.

---

## Where is the audit log?

Settings → Audit log tab. Filter by entity type. Celestial chat events appear as `celestial.chat`.

---

## What feature tiers were added?

Cosmos development is organized in tiers (4–15). Key tiers:
- **Tier 4:** Invoicing, returns, buyer quotes
- **Tier 5:** GL auto-posting, AP vendor bills
- **Tier 6:** Notifications, buyer invoices, contract pricing, reorder
- **Tier 8:** COGS, wave picking, bins, POS registers, global search
- **Tier 13:** Feature flags UI, POS checkout UI, bin-directed picking
- **Tier 15:** Celestial AI assistant

Full tier changelog is in `PLATFORM_FEATURES.md` → Recent additions.
