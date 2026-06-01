# Celestial AI Assistant (LLM Knowledge Base)

Complete reference for the Celestial AI copilot — how it works, what it can answer, and configuration.

**Keywords:** Celestial, AI, assistant, chat, copilot, LLM, OpenRouter, RAG, tools, streaming

---

## What is Celestial?

Celestial is Cosmos's built-in **AI assistant** (Tier 15). It answers questions about how Cosmos works and queries **live tenant data** (orders, warehouses, invoices, catalog, etc.).

**Surfaces:**
- **Admin full page:** `/admin/celestial`
- **Floating ✦ panel** on admin and shop layouts (shared chat history via Zustand store `cosmos-celestial-v1`)
- **Buyer portal:** same floating panel on shop pages (buyer-scoped data only)

**Feature flag:** Requires `celestial` enabled in Settings → Features.

---

## How Celestial answers questions

Celestial uses a **hybrid architecture:**

1. **Intent detection** — classifies the question as data lookup vs how-to vs general
2. **Live data tools** — runs SQL-backed queries for orders, invoices, warehouses, catalog, etc.
3. **Documentation RAG** — retrieves relevant chunks from `docs/celestial/*.md` and `PLATFORM_FEATURES.md`
4. **LLM synthesis** — OpenRouter/Groq/Gemini/Ollama generates a Markdown answer using docs + tool JSON
5. **Direct compose** — for data questions with results, returns formatted Markdown tables without LLM (faster, more accurate)
6. **Fallback** — if LLM fails or returns empty, Celestial uses doc excerpts or a helpful default (never silent)

**Rule:** Celestial must always produce an answer — it does not leave questions unanswered.

---

## Live data tools

| Tool | Who | Triggers (examples) | Returns |
|------|-----|---------------------|---------|
| `get_my_orders` | Admin + buyer | "my orders", "pending orders", "any orders pending?" | Order list with status, total, dates |
| `get_order_detail` | Admin + buyer | order ID in message | Line items, payment, status |
| `list_my_invoices` | Admin + buyer | "invoices", "balance due", "what do I owe" | Invoice numbers, balances |
| `search_catalog` | Admin + buyer | "catalog", "SKU", "products", "stock" | In-stock SKUs with prices |
| `list_my_quotes` | Admin + buyer | "quotes", "counter-offer" | Open quotes |
| `list_warehouses` | Admin + buyer | "warehouses", "locations", "distribution centers" | Warehouse codes, names, addresses |
| `global_search` | Admin only | "find customer Acme", explicit search | Orders, customers, SKUs, quotes |
| `list_low_stock` | Admin only | "low stock", "reorder point" | SKUs below reorder point |

**Buyer scoping:** Buyers only see their CRM customer's orders/invoices/quotes. Admins see all tenant data.

**How-to questions** (e.g. "How does POS work?") skip data tools and use documentation + LLM.

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/celestial/chat` | JSON chat (or SSE if `Accept: text/event-stream` or `X-Celestial-Stream: 1`) |
| POST | `/api/v1/celestial/chat/stream` | Dedicated SSE streaming endpoint |
| GET | `/api/v1/celestial/status` | Provider, model, mock mode status |

**Request body:** `{ message, conversationId?, surface?, context?: { page?, orderId?, quoteId? } }`

**Response:** `{ conversationId, reply, links, toolsUsed, provider, model }`

**Streaming events:** `delta` (text chunks), `done` (metadata), `error`.

---

## LLM provider configuration

Set in root `.env` (synced to `apps/web/.env.local` on `npm run dev`):

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key (recommended) |
| `CELESTIAL_PROVIDER=openrouter` | Force OpenRouter provider |
| `CELESTIAL_MODEL=openrouter/auto` | Model selection |
| `GROQ_API_KEY` | Groq provider |
| `GEMINI_API_KEY` | Google Gemini provider |
| `CELESTIAL_PROVIDER=ollama` | Local Ollama |
| (none) | **Mock mode** — tool-backed structured answers without external LLM |

**Status check:** `GET /celestial/status` shows active provider and whether running in mock/demo mode.

---

## Documentation sources (RAG)

Celestial indexes markdown from:
- `docs/celestial/*.md` — LLM-optimized knowledge base (this folder)
- `PLATFORM_FEATURES.md` — full platform feature reference and tier changelog

Retrieval uses keyword + acronym scoring (POS, WMS, AR, AP, ERP, MSA, etc.) with fallback chunks when query match is weak.

---

## Example questions Celestial can answer

**Live data (admin):**
- "What warehouses do we have?"
- "Any orders pending?"
- "Show low stock items"
- "Find customer Acme"

**Live data (buyer):**
- "Where is my order?"
- "Show my open invoices"
- "Search catalog for energy drinks"

**How-to / documentation:**
- "How does POS work in Cosmos?"
- "Explain the order fulfillment workflow"
- "What is wave picking?"
- "How do I process a return?"
- "What is MSA compliance?"
- "How does contract pricing work?"

**General:**
- "What modules does Cosmos have?"
- "What are the demo login credentials?"
- "How do I run Cosmos locally?"

---

## Conversation persistence

- Conversations stored in analytics DB: `CelestialConversation`, `CelestialMessage`
- Client store persists messages in localStorage (`cosmos-celestial-v1`) across routes
- Audit log records `celestial.chat` events

---

## UI features

- **Markdown rendering** — headings, lists, tables, code blocks with syntax highlighting
- **Streaming** — token-by-token SSE display
- **Contextual links** — tool results include deep links to orders, invoices, catalog
- **Page context** — optional `context.page` hint passed from current admin/shop route

---

## Implementation files

| Area | Path |
|------|------|
| Orchestrator | `apps/web/lib/server/celestial/orchestrator.ts` |
| Intent | `apps/web/lib/server/celestial/intent.ts` |
| Tools | `apps/web/lib/server/celestial/tools.ts` |
| LLM | `apps/web/lib/server/celestial/llm.ts` |
| RAG retrieval | `apps/web/lib/server/celestial/retrieval.ts` |
| Direct compose | `apps/web/lib/server/celestial/compose.ts` |
| Prompts | `apps/web/lib/server/celestial/prompts.ts` |
| Admin UI | `apps/client/src/pages/admin/celestial/`, `components/celestial/` |
| Store | `apps/client/src/stores/celestial-store.ts` |
