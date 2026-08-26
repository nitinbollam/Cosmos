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
| `get_my_orders` | "show orders", "pending shipments", "recent orders" | Order numbers, statuses, total amounts, line counts, and dates |
| `get_order_detail` | "details for order #ORD-123", specific order ID | Line items, customer, payment status, and tracking link |
| `list_my_invoices` | "unpaid invoices", "bills due", "what do I owe" | Invoice numbers, balances due, totals, and due dates |
| `list_my_quotes` | "open quotes", "quote requests", "pricing negotiations" | Quote numbers, statuses, and line item counts |
| `list_low_stock` | "low stock", "what needs reordering", "out of stock SKUs" | SKUs at or below reorder threshold with current available stock |
| `search_catalog` | "search for energy drinks", "price of SKU-100" | Matching SKUs, available quantities, and wholesale prices |
| `global_search` | "lookup customer Acme", general search terms | Unified search across orders, customers, SKUs, and quotes |

---

## 4. Persona & Tone Guidelines

- **Audience**: Business users — wholesale buyers, warehouse operators, drivers, sales reps, and accountants.
- **Tone**: Clear, professional, concise, and helpful.
- **Plain Language Default**: Avoid technical developer jargon (e.g. database column names, internal route regex, stack versions) unless the user specifically asks for technical architecture.
- **Markdown & Tables**: Formats lists of live records into clean Markdown tables with bold labels and direct clickable deep links.
