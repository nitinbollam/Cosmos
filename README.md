# Cosmos

Production-grade, cloud-native ERP and distribution management platform for wholesale and regulated distribution industries (tobacco, vape, general wholesale).

A monorepo containing:

- **`apps/`** — web frontends (Next.js 14) and mobile apps (Expo SDK 51)
- **`services/`** — NestJS 10 microservices (Postgres + Prisma + Redis/BullMQ)
- **`packages/`** — shared TypeScript packages (event-bus, logger, config, types, auth, metrics, tracing, ui, **analytics-engine**)
- **`ai/`** — *(legacy, optional)* Python FastAPI sidecars — superseded for web-admin by **`@cosmos/analytics-engine`**
- **`infra/`** — Docker, Kubernetes (Kustomize), Terraform (AWS EKS + RDS + Redis + S3)

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (`corepack enable && corepack prepare pnpm@9.7.0 --activate`)
- Docker + Docker Compose
- (Optional) Python >= 3.11 — **only if** you still run legacy `ai/` sidecars (not required for web-admin)
- (Optional) AWS CLI for infra

## Quickstart

```bash
# 1. Install all JS deps
pnpm install

# 2. Bring up Postgres 16, Redis 7, MinIO (S3 dev), OTel collector
pnpm infra:up

# 3. Copy and edit env
cp .env.example .env

# 4. Generate Prisma clients and run migrations across services
pnpm db:generate
pnpm db:migrate

# 5. Run admin stack (recommended — no Python, no mobile, Turbopack HMR)
pnpm dev:admin

# Or run everything (all Nest services + mobile + storefront)
pnpm dev
```

Ensure root **`.env`** sets service URLs (see **`.env.example`**): gateway needs **`AUTH_SERVICE_URL`**, **`INVENTORY_SERVICE_URL`**, etc. Inventory and other admin pages call **`http://localhost:3000/api/v1`** by default (**`NEXT_PUBLIC_GATEWAY_URL`**).

**Docker:** `pnpm infra:up` needs the Docker daemon (on Windows, start **Docker Desktop** first). If Compose fails with a `dockerDesktopLinuxEngine` / pipe error, the engine is not running.

**Package manager:** If `pnpm` is not on your PATH, use e.g. `npx pnpm@9.7.0` for the commands above (same as root `packageManager` pin).

## Service ports (dev)

| Service | Port | Stack |
|---|---|---|
| gateway-service | 3000 | NestJS |
| auth-service | 3001 | NestJS |
| tenant-service | 3002 | NestJS |
| inventory-service | 3003 | NestJS |
| wms-service | 3004 | NestJS |
| order-service | 3005 | NestJS |
| purchasing-service | 3006 | NestJS |
| compliance-service | 3007 | NestJS |
| storefront-service | 3008 | NestJS |
| pos-service | 3009 | NestJS |
| crm-service | 3010 | NestJS |
| dispatch-service | 3011 | NestJS |
| payment-service | 3012 | NestJS |
| ledger-service | 3013 | NestJS |
| analytics-service | 3014 | NestJS |
| notification-service | 3015 | NestJS |
| web-admin | 4000 | Next.js (Turbopack dev) |
| web-storefront | 4001 | Next.js |

**Analytics in web-admin:** cashflow forecast + anomaly detection run in **`/api/cashflow`** and **`/api/anomaly`** (TypeScript, no Python sidecar).

Legacy optional sidecars (not started by `pnpm dev:admin`):

| Service | Port | Stack |
|---|---|---|
| cosmos-llm | 8001 | FastAPI (legacy) |
| demand-forecasting | 8002 | FastAPI (legacy) |
| ocr-engine | 8003 | FastAPI (legacy) |
| cashflow-model | 8004 | FastAPI (legacy — superseded by Next.js) |
| anomaly-detection | 8005 | FastAPI (legacy — superseded by Next.js) |

Each Nest service exposes **GET /metrics** (Prometheus text, via `@cosmos/metrics`) on the same port as the API, outside the `/api/v1` prefix.

### Windows: Prisma `EPERM` on `query_engine`

If `prisma generate` or `pnpm prod:preflight` fails renaming `query_engine-windows.dll.node`, another process (often a stuck `nest start`, Jest run, or tool importing `@prisma/client`) still has the DLL open. Stop those Node processes, then retry. To see which engine files are locked:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/diagnose-prisma-engines.ps1
```

(PowerShell 7 users can use `pwsh` instead of `powershell`.)

Root `pnpm db:generate` uses per-service scripts with retries (`scripts/prisma-generate-retry.mjs`); persistent locks still require releasing the file.

**Technical monorepo gate:** `pnpm prod:preflight` runs lint → test → build via Turbo. On Windows the preflight script lowers Turbo concurrency to reduce parallel Prisma generates; Linux CI is unaffected.

## B2B storefront (`web-storefront`)

Buyer flow is under the **`(shop)`** route group (shared **ShopHeader**): **Catalog** (filters, search, Zustand cart), **Cart**, **Checkout** (shipping → payment → review → **`POST /orders`** with **`Idempotency-Key`**), **order confirmation**, **orders** list (scoped by **`customerId`** + **`B2B_PORTAL`** when session is set), **quotes** unchanged. **Login** resolves a **CRM `Customer`** row whose **email** matches the JWT email and stores **`cosmos.customerId`** / **`cosmos.tenantId`** in **sessionStorage**; without that record, sign-in is rejected with a clear message. Design tokens live in **`app/globals.css`**; logo on dark **`#000000` / `#06060F`** only.

Set **`NEXT_PUBLIC_GATEWAY_URL`** (defaults to `http://localhost:3000/api/v1`) and optionally **`NEXT_PUBLIC_WEB_ADMIN_ORIGIN`** for admin deep links on orders.

## Implementation status

See `MISSING.md` for a precise breakdown of which modules are production-grade vs. scaffolded.

## License

Proprietary — FastFlyrr Technology Group.
