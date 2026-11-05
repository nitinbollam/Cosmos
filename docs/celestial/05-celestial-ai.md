# Celestial AI Assistant Reference (LLM Knowledge Base)

Comprehensive architecture and usage guide for **Celestial** — the embedded AI copilot in Pleros.

**Keywords:** Celestial, AI, copilot, assistant, LLM, RAG, tool calling, intent detection, search, data lookups, chat, prompt engineering

---

## 1. What is Celestial?

**Celestial** is the AI assistant built directly into Pleros. It combines two core superpowers:
1. **Live Tenant Data Queries**: Executes secure backend tools to look up real-time orders, stock levels, warehouses, invoices, and customer records.
2. **Platform Knowledge Base (RAG)**: Retrieves indexed documentation to explain platform workflows, features, setup, and troubleshooting in plain, friendly language.

---

## 2. Where to Access Celestial

- **Admin Full Page (`/admin/celestial`)**: Dedicated workspace with full conversation history, suggested prompt chips, and deep links.
- **Floating Copilot Widget**: Available in the bottom-right corner of all back-office admin and B2B shop pages.
- **Contextual Page Awareness**: Automatically passes the active UI page, order ID, or quote ID into Celestial context.

---

## 3. Celestial Tool Capabilities

When a user asks a question requiring factual live data, Celestial automatically detects intent and executes targeted backend tools:

| Tool Name | Trigger Keywords | What it Returns |
| :--- | :--- | :--- |
| `list_warehouses` | "what warehouses do we have", "locations", "DC sites" | Active warehouse codes, names, addresses, and default status |
| `orders.list` | "show pending orders", "backordered orders from last month, oldest first", "urgent Shopify orders" | Orders filtered by any of the 11 statuses, channel, priority and date range, with an all-match count |
| `orders.detail` | "status of ORD-1001", "order #1042" | Line items (allocated / backordered), customer, totals, and recorded shipments (carrier, tracking, ship date) |
| `inventory.stock` | "how much cable stock do we have", "which SKUs are available in each warehouse" | Available / on-hand / reserved / reorder point per SKU and warehouse, with units |
| `purchasing.orders` | "show purchase orders", "partially received POs from Pacific Supply" | PO numbers, suppliers, receipt progress, and goods cost (shown as unknown when a line has no cost) |
| `purchasing.order_detail` | "show the lines on PO-1001" | PO lines with received vs ordered quantities, unit costs, and related vendor bills |
| `purchasing.requisitions` | "any requisitions waiting for approval", "show open requisitions" | Requisition numbers, statuses, suppliers, quantities, and estimated goods cost |
| `purchasing.requisition_detail` | "status of PR-1001" | Requisition lines, approval history, rejection or cancellation reason, and the PO it became |
| `finance.bills` | "which vendor bills are past due", "bills due this month", "how much do we owe Pacific Supply" | Vendor bills (accounts payable) with balances and due dates; totals kept separate per currency |
| `list_my_invoices` | "unpaid invoices", "which customers owe us" | Customer invoices (accounts receivable) with balances and totals |
| `quotes.list` | "open quotes", "approved quotes" | Quote numbers, statuses, customers, totals, and whether each was converted to an order |
| `quotes.detail` | "show quote Q-AB12CD34" | Quote lines, status, rejection reason, and the converted order if any |
| `list_low_stock` | "low stock", "what needs reordering", "out of stock SKUs" | SKUs at or below reorder threshold with current available stock |
| `search_catalog` | "show the cable product", "all products containing cable" | Matching SKUs, available quantities, and prices; asks which product if none is named |
| `global_search` | "lookup customer Acme", general search terms | Unified search across orders, customers, SKUs, and quotes |

Every tool is read-only and checks the employee's module permission (for example `finance.read` for vendor bills and invoices) on each request. If the employee lacks access, Celestial says so instead of answering.

### Questions that combine modules

One question can run up to six lookups, and Celestial answers them together:

- **Comparing periods:** "compare sales this quarter vs last quarter", "how many orders last month vs this month". You get each period's figures and the change between them.
- **One supplier across purchasing and finance:** "show Pacific Supply's purchase orders and their bills". You get the supplier's POs, its vendor bills and open balance, and goods ordered vs billed.
- **One customer across sales and finance:** "show Acme's orders, quotes and unpaid invoices". You get counts for each and what the customer still owes.
- **Receivables vs payables:** "what do customers owe us vs what we owe suppliers", "what's our net position". You get open AR and AP per currency and the net.

How these answers are built:

- Pleros works out the comparison from every matching record, not just the rows shown.
- Currencies are never added together or converted.
- If a PO line has no cost recorded, if a total is partial, or if one lookup is missing, the answer says so instead of counting it as zero.
- Each lookup has a time limit. A lookup that runs too long is reported as missing, and the rest of the answer is still shown.

---

## 4. Persona & Tone Guidelines

- **Audience**: Business users — wholesale buyers, warehouse operators, drivers, sales reps, and accountants.
- **Tone**: Clear, professional, concise, and helpful.
- **Plain Language Default**: Avoid technical developer jargon (e.g. database column names, internal route regex, stack versions) unless the user specifically asks for technical architecture.
- **Markdown & Tables**: Formats lists of live records into clean Markdown tables with bold labels and direct clickable deep links.
