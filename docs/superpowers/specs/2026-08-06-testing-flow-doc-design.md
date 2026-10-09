# Testing Flow Documentation — Design Spec

Date: 2026-08-06
Status: Approved

## Purpose

Replace the existing, untracked `docs/TESTING_FLOW.md` (1440 lines, never committed) with a
comprehensive, accurate, single-file Testing Flow Documentation for the Pleros/Cosmos ERP
monorepo. The document is the single source of truth for how to test the application —
setup, startup, end-to-end flow, module-by-module checklists, API contracts, regression/smoke
checklists, troubleshooting, and release validation — usable by developers, QA engineers, and
new team members without additional guidance.

The prior draft was written from a template without verifying claims against the actual
codebase. This rewrite is done from scratch, with every concrete claim (env var name, script
path, endpoint name, schema name, route) verified against the repository before it is written
down.

## Confirmed Ground Truth (from codebase survey)

- **Frontend** (`apps/client`): buyer storefront (`catalog`, `cart`, `checkout`, `orders`,
  `invoices`, `quotes`, `account`), Admin console (`pages/admin/*`: celestial, compliance, crm,
  customers, dispatch, finance, fulfillment, inventory, notifications, onboarding, orders, pos,
  purchasing, quotes, reports, settings, warehouse), Mobile PWA (`pages/m/*`: login, sales,
  delivery, warehouse, plus nested `warehouse/receiving`, `warehouse/task/[id]`,
  `warehouse/waves/[id]`, `delivery/route/[id]`). Auth pages: login, signup, forgot-password,
  reset-password, verify-email, accept-invite.
- **Backend** (`apps/web/lib/server/*.ts`): ~90 domain modules wired through
  `native-router.ts` / `server/api-router.ts`. Not a standalone Express server — served by the
  same single-origin Vite/Express process as the client, on port 4000. Domains include auth,
  billing/payments/stripe, orders/order-orchestration/order-saga, inventory/wms-*,
  purchasing/po-receiving/ap-bills, dispatch, crm, pos, compliance-*, bank-recon/ledger/
  operations-gl/fixed-assets, notifications, celestial (AI/RAG subfolder), and infra
  (db/db-health/env/prisma).
- **Data layer**: 14 Prisma schemas under `apps/web/prisma/<domain>/schema.prisma`:
  analytics, auth, compliance, crm, dispatch, inventory, ledger, notification, order, payment,
  purchasing, storefront, tenant, wms. SQLite locally, Postgres in staging/production
  (`scripts/setup-sqlite.mjs`, `scripts/setup-postgres.mjs`, `scripts/apply-prisma-provider.mjs`).
- **Test tooling actually in place**: Node's built-in `--test` runner via `tsx`, no
  Jest/Vitest/Playwright/Cypress/Mocha anywhere in the repo. ~34 unit test files total
  (27 in `apps/web/lib/server`, 4 in `apps/client`, 3 across `packages/*`). Zero E2E/browser
  test suite exists today. The document must describe this reality, not prescribe tooling that
  isn't there.

## Decisions (confirmed with user)

1. **Section 5 (Module-by-Module Testing) is organized by user-facing module**, not by all ~90
   backend files. One subsection per: 18 admin console areas, Buyer Portal, 3 Mobile PWA roles
   (sales, delivery, warehouse), Settings. Each subsection references the backend files/
   endpoints and Prisma schemas it depends on, rather than backend modules each getting their
   own top-level section.
2. **Section 8 (API Testing) uses tiered depth.** Full request/response/error-case examples for
   the highest-risk, highest-traffic modules: auth, orders, invoices/ledger, inventory, POS,
   dispatch, fixed-assets, purchasing. All remaining ~80 backend modules get a compact
   reference table (endpoint, method, auth requirement, purpose) instead of worked examples.
3. **Single output file.** `docs/TESTING_FLOW.md` is overwritten in place as one comprehensive
   document (no split into appendix files), matching the original single-source-of-truth intent.

## Document Structure (17 sections, per original template)

1. Overview — purpose, scope, architecture diagram (verified stack above), testing philosophy.
2. Prerequisites — Node/npm versions, env vars (verified against `.env.example`), SQLite vs
   Postgres setup, seed script (`scripts/seed-db.ts`).
3. Application Startup Flow — single-origin server, `npm run dev`, health checks.
4. End-to-End Testing Flow — Login → Admin Dashboard → module chain → Buyer Portal → Mobile
   PWA → Reports → Settings → Logout, with rationale for the order.
5. Module-by-Module Testing — per decision #1 above; each module gets purpose, entry point,
   dependencies, backing API/DB, required roles, and a full checklist (functional, UI,
   validation, navigation, permissions, error handling, edge cases, empty/loading states,
   success/failure scenarios).
6. Feature Dependencies — e.g. POS → Inventory + Pricing + Tax; Dispatch → Orders + WMS;
   Fixed Assets → Ledger.
7. Test Data — sample users per role, seed script usage, reset flow.
8. API Testing — per decision #2 above.
9. Integration Testing — Frontend↔Backend, Backend↔Prisma↔DB, verified third-party
   integrations (Stripe/SendGrid/Twilio — confirmed present, not assumed), Celestial AI/RAG
   flow.
10. Regression Testing Checklist — critical journeys: order-to-cash, procure-to-pay, WMS
    pick/pack/ship, POS sale, fixed-asset depreciation run.
11. Smoke Testing Checklist — fast post-deploy validation.
12. Common Failure Scenarios — grounded in actual code patterns (multi-Prisma-schema
    gotchas, tenant scoping).
13. Troubleshooting Guide — startup/build/API/auth/DB/env issues specific to this repo's
    actual scripts.
14. Release Validation Flow — Build → Smoke → Functional → Integration → Regression →
    Performance → Sign-off.
15. Visual Flow Diagrams — Mermaid: user flow, auth flow, order lifecycle, WMS flow, API
    flow, dependency graph.
16. Best Practices — execution order, avoiding flakiness under `node --test`, bug report
    format.
17. Appendix — npm scripts (from `package.json`), env var reference, DB scripts, useful URLs.

## Formatting Requirements

- Clean Markdown, logical heading hierarchy, tables for test cases/APIs/checklists.
- Mermaid diagrams for workflows and dependency graphs.
- Callout blocks (`> [!NOTE]`, `> [!WARNING]`, `> [!TIP]`) for important notes/warnings/tips.
- `- [ ]` checklists for release/regression/smoke sections.
- Collapsible (`<details>`) sections for lengthy per-module detail where it aids scanning.

## Out of Scope

- No changes to `docs/QA_STAGING_CHECKLIST.md`, `ERP_FEATURE_GAP.md`, `PLATFORM_FEATURES.md`,
  or `PRODUCTION_READINESS.md` — this task only produces `docs/TESTING_FLOW.md`.
- No new test code, tooling, or CI changes — this is documentation only.
- No changes to unrelated working-tree modifications already present
  (`README.md`, `apps/web/lib/server/finance-enhancements.test.ts`) — those are pre-existing
  uncommitted changes from other work and are untouched by this task.

## Verification Approach

Because the document makes many concrete factual claims, drafting will proceed
module-by-module with direct inspection of the relevant source files (route handlers, Prisma
schemas, `.env.example`, `package.json` scripts) rather than inference from the prior draft or
memory. Given the scale (~90 backend modules, 18 admin areas, 14 schemas), drafting will likely
be split across multiple passes/subagents by section to keep each pass grounded in real file
reads, then assembled into the single final `docs/TESTING_FLOW.md`.
